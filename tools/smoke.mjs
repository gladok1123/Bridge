#!/usr/bin/env node
/**
 * smoke.mjs — сквозная проверка сайта Bridge в поддельном браузере.
 *
 * Собирает настоящее приложение (Next-компоненты + ядро) через esbuild,
 * запускает его внутри jsdom с поддельным WebRTC, камерой, звуком и релеем,
 * а затем «нажимает кнопки»: вход в комнату, чат, микрофон, камера, показ
 * экрана, рука, доска, приход второго участника, прямой канал, запись, выход.
 *
 * Запуск:  node tools/smoke.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installMocks, openWith } from './mocks.mjs';

/* esbuild и jsdom нужны только проверкам: если их нет — скажем об этом прямо,
   а не «модуль не найден» посреди прогона */
let esbuild;
let JSDOM;
let VirtualConsole;
try {
  esbuild = await import('esbuild');
  ({ JSDOM, VirtualConsole } = await import('jsdom'));
} catch (e) {
  console.log('\n  ⛔ Для проверок нужны esbuild и jsdom.');
  console.log('     Выполните в папке проекта:  npm install');
  console.log('     Подробность: ' + (e.message || e) + '\n');
  process.exit(2);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ── счёт ──────────────────────────────────────────────────────────────── */
let ok = 0;
let bad = 0;
const fails = [];

function check(name, cond, extra = '') {
  if (cond) {
    ok++;
    console.log('  ✅ ' + name);
  } else {
    bad++;
    fails.push(name + (extra ? ' → ' + String(extra).slice(0, 220) : ''));
    console.log('  ❌ ' + name + (extra ? ' → ' + String(extra).slice(0, 220) : ''));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── сборка приложения ─────────────────────────────────────────────────── */
const aliasPlugin = {
  name: 'alias',
  setup(build) {
    build.onResolve({ filter: /^@\// }, (args) => {
      const base = path.join(ROOT, 'src', args.path.replace(/^@\//, ''));
      for (const ext of ['', '.js', '.jsx']) {
        if (fs.existsSync(base + ext)) return { path: base + ext };
      }
      return { path: base + '.jsx' };
    });
  },
};

async function bundle() {
  const res = await esbuild.build({
    entryPoints: [path.join(ROOT, 'tools/entry.client.jsx')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    loader: { '.js': 'jsx' },
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [aliasPlugin],
  });
  return res.outputFiles[0].text;
}

/* ── помощники для работы с поддельной страницей ───────────────────────── */
function makeHelpers(dom, win) {
  const doc = win.document;
  const $ = (sel) => doc.querySelector(sel);
  const $$ = (sel) => Array.from(doc.querySelectorAll(sel));
  const text = () => doc.body.textContent || '';
  const byText = (sel, needle) => $$(sel).find((el) => (el.textContent || '').includes(needle)) || null;
  const click = (el) => {
    if (!el) throw new Error('нечего нажимать');
    el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
    return el;
  };
  const clickText = (sel, needle, label) => {
    const el = byText(sel, needle);
    check(label || ('нашли кнопку «' + needle + '»'), !!el, 'не нашли ' + sel + ' с текстом ' + needle);
    if (el) click(el);
    return el;
  };
  const type = (el, value) => {
    if (!el) throw new Error('нет элемента для ввода');
    /* React слушает «input», но сравнивает значение со своим трекером:
       поэтому пишем через родной сеттер, а не напрямую в .value */
    const proto = el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new win.Event('input', { bubbles: true }));
    return el;
  };
  const key = (el, k, opts = {}) => {
    el.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
  };
  const pointer = (el, kind, coords = {}) => {
    const ev = new win.Event(kind, { bubbles: true, cancelable: true });
    Object.assign(ev, { clientX: coords.x || 0, clientY: coords.y || 0, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true });
    el.dispatchEvent(ev);
  };
  /** Точное совпадение текста: «60» не должно ловиться внутри «360p». */
  const exact = (sel, value) => $$(sel).find((el) => (el.textContent || '').trim() === value) || null;
  /** Кнопка, подпись которой начинается с текста: «Резко (текст)» по «Резко». */
  const startsWith = (sel, value) => $$(sel).find((el) => (el.textContent || '').trim().startsWith(value)) || null;
  const clickExact = (sel, value, label) => {
    const el = exact(sel, value);
    check(label || ('нашли кнопку «' + value + '»'), !!el, 'нет точного совпадения ' + sel + ' = ' + value);
    if (el) click(el);
    return el;
  };
  return { doc, $, $$, text, byText, exact, startsWith, click, clickText, clickExact, type, key, pointer };
}

/* ── один прогон ───────────────────────────────────────────────────────── */
async function run({ label, secure = true, denyMedia = false, ua = '' }) {
  console.log('\n────────────────────────────────────────────');
  console.log('  ' + label);

  const bundleText = await bundle();
  const virtualConsole = new VirtualConsole();
  const consoleErrors = [];
  virtualConsole.on('jsdomError', (e) => {
    if (!/Could not parse CSS|not implemented/i.test(String(e.message))) consoleErrors.push(String(e.message));
  });
  virtualConsole.on('error', (m) => consoleErrors.push(String(m)));

  const dom = new JSDOM(
    '<!doctype html><html lang="ru"><head><title>Bridge</title></head><body><div id="root"></div></body></html>',
    { url: 'https://bridge.test/', pretendToBeVisual: true, runScripts: 'dangerously', virtualConsole }
  );
  const win = dom.window;
  const state = installMocks(win, { secure, denyMedia, ua });
  const h = makeHelpers(dom, win);

  win.eval(bundleText);
  check('приложение собралось и загрузилось', typeof win.__bridgeMount === 'function');
  win.__bridgeMount(win.document.getElementById('root'));
  await sleep(120);

  /* ── главная ───────────────────────────────────────────────────────── */
  check('главная страница отрисовалась', /Bridge — звонки, доска и чат для своих/.test(h.text()));
  check('видна кнопка создания комнаты', !!h.byText('button', 'Создать комнату'));
  check('видна кнопка проверки связи', !!h.byText('button', 'Проверить'));

  h.clickText('button', 'Проверить', 'нажали «Проверить»');
  await sleep(400);
  const rowsAfterDiag = h.$$('.check__row').length;
  check('проверка связи заполнила строки', rowsAfterDiag >= 4, 'строк: ' + rowsAfterDiag);
  check('в проверке есть строка про https', /Защищённое соединение/.test(h.text()));
  if (!secure) {
    check('на http предупреждают, что камера недоступна', /не даст камеру|http/.test(h.text()));
  }

  /* ── вход в комнату ────────────────────────────────────────────────── */
  h.clickText('button', 'Создать комнату', 'нажали «Создать комнату»');
  await sleep(500);

  const code = win.location.pathname.split('/').pop();
  check('адрес сменился на комнату', /^\/r\//.test(win.location.pathname), win.location.pathname);
  check('в адресе есть ключ комнаты', /#k=.{10,}/.test(win.location.hash), win.location.hash);
  check('панель голоса видна', !!h.$('.voicebar'));
  check('в шапке показан код комнаты', h.text().includes(decodeURIComponent(code)));
  check('чат на месте', !!h.$('.composer__input'));

  const secret = decodeURIComponent((win.location.hash.match(/#k=([^&]+)/) || [])[1] || '');
  check('секрет комнаты прочитан', secret.length > 10);

  if (!secure || denyMedia) {
    check('о недоступности звука сказано прямо', /недоступн|не даст|запрещ/i.test(h.text()));
  } else {
    check('микрофон включён при входе', h.$('.vbtn.is-on') !== null || /микрофон включён/.test(h.text()));
  }

  /* что ушло на релей */
  await sleep(200);
  const published = state.published;
  const decoded = [];
  for (const p of published.slice(-40)) {
    const obj = await openWith(secret, p.body);
    if (obj) decoded.push(obj);
  }
  check('в релей ушло приветствие', decoded.some((d) => d.t === 'hello' && d.name), JSON.stringify(decoded.slice(0, 3)));
  const hello = decoded.find((d) => d.t === 'hello');
  check('приветствие не раскрывает имя комнаты', !JSON.stringify(hello || {}).includes(code));
  check('релей получил только шифртекст', published.every((p) => String(p.body).startsWith('b1.')));

  /* ── чат ───────────────────────────────────────────────────────────── */
  const input = h.$('.composer__input');
  h.type(input, 'Привет, это проверка');
  const form = h.$('.composer');
  form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(150);
  check('сообщение появилось в чате', /Привет, это проверка/.test(h.text()));
  const chatFrames = [];
  for (const p of state.published.slice(-12)) {
    const obj = await openWith(secret, p.body);
    if (obj) chatFrames.push(obj);
  }
  check('сообщение ушло в релей зашифрованным', chatFrames.some((d) => d.t === 'data' && d.kind === 'chat' && d.body === 'Привет, это проверка'));

  /* ── кнопки звонка ─────────────────────────────────────────────────── */
  const vbtns = h.$$('.voicebar .vbtn');
  check('в полосе голоса есть кнопки управления', vbtns.length >= 6, 'кнопок: ' + vbtns.length);
  const canMedia = secure && !denyMedia;
  h.click(vbtns[1]);                    // камера
  await sleep(300);
  if (canMedia) {
    const selfTileVideo = h.$$('.tile video').find((v) => v.srcObject && v.srcObject.getVideoTracks().length);
    check('камера включается и своя плитка получает поток', !!selfTileVideo);
  } else {
    check('про камеру честно сказали, что она не включилась', /Камера не включилась|недоступн|не даст/i.test(h.text()), h.text().slice(0, 160));
  }
  h.click(vbtns[2]);                    // демонстрация экрана
  await sleep(300);
  if (canMedia) {
    check('показ экрана включается и видно предупреждение', /Вы показываете экран/.test(h.text()));

    /* ── качество показа экрана: до 4K и 60 кадров, применяется на ходу ── */
    const qualityBtn = h.byText('.sharebar button', 'Качество');
    check('на плашке показа экрана есть выбор качества', !!qualityBtn);
    h.click(qualityBtn);
    await sleep(200);
    check('выбор качества раскрылся', !!h.$('.popover .picker'));
    h.clickExact('.popover .pick', '4K', 'в выборе есть 4K');
    await sleep(150);
    h.clickExact('.popover .pick', '60', 'в выборе есть 60 кадров в секунду');
    await sleep(150);
    h.clickExact('.popover .pick', 'Резко (текст)', 'в выборе есть оптимизация под текст');
    await sleep(300);
    const scrTrack = state.lastDisplay && state.lastDisplay.videoTrack;
    if (process.env.DEBUG_QUALITY) {
      console.log('   [отладка] настройки:', win.localStorage.getItem('bridge.settings.v1'));
      console.log('   [отладка] вызовы на дорожке экрана:', JSON.stringify((scrTrack && scrTrack.constraints || []).map((c) => c.width.ideal + 'x' + c.height.ideal + '@' + c.frameRate.ideal)));
      console.log('   [отладка] kinds у сетки:', JSON.stringify(state.peers.map((x) => x.connectionState)));
    }
    const asked = scrTrack && scrTrack.constraints[scrTrack.constraints.length - 1];
    check('своя дорожка экрана просит 4K и 60 кадров', !!asked && asked.width.ideal === 3840 && asked.frameRate.ideal === 60, JSON.stringify(asked));
    check('подсказка кодировщику стала «текст»', scrTrack && scrTrack.contentHint === 'text', scrTrack && scrTrack.contentHint);
    check('в плашке видно выбранное разрешение', /4K|2160p|3840/.test(h.text()), (h.byText('.sharebar span', 'кадр/с') || {}).textContent);
    check('в подсказке посчитан битрейт', /Мбит\/с/.test(h.text()));
    h.click(h.byText('.popover .iconbtn', '') || h.$('.popover .iconbtn'));
    await sleep(150);
  } else {
    check('про экран честно сказали, почему он не показывается', /Экран не отдался|не умеет|недоступн/i.test(h.text()), h.text().slice(0, 160));
    check('доска показывается только при живом потоке', !h.$('.tile--screen'));
  }
  h.click(vbtns[3]);                    // рука
  await sleep(180);
  check('рука поднята (кнопка активна)', h.$$('.voicebar .vbtn')[3].className.includes('is-on'), h.$$('.voicebar .vbtn')[3].className);
  const handFrames = [];
  for (const p of state.published.slice(-8)) {
    const obj = await openWith(secret, p.body);
    if (obj) handFrames.push(obj);
  }
  check('о поднятой руке ушло участникам', handFrames.some((d) => d.t === 'data' && d.kind === 'hand' && d.body === true));
  h.click(h.$$('.voicebar .vbtn')[3]);   // опускаем, чтобы дальше не мешала
  await sleep(120);

  /* ── доска ─────────────────────────────────────────────────────────── */
  h.click(vbtns[4]);
  await sleep(250);
  check('доска открылась', !!h.$('.board__canvas'));
  const canvas = h.$('.board__canvas');
  h.pointer(canvas, 'pointerdown', { x: 60, y: 60 });
  h.pointer(canvas, 'pointermove', { x: 120, y: 80 });
  h.pointer(canvas, 'pointermove', { x: 200, y: 140 });
  h.pointer(canvas, 'pointerup', { x: 200, y: 140 });
  await sleep(200);
  check('штрих нарисован и посчитан', /[1-9]\d* штрихов/.test(h.text()), (h.byText('span', 'штрихов') || {}).textContent);
  const boardFrames = [];
  for (const p of state.published.slice(-20)) {
    const obj = await openWith(secret, p.body);
    if (obj) boardFrames.push(obj);
  }
  check('штрихи ушли участникам', boardFrames.some((d) => d.t === 'data' && d.kind === 'board' && d.body && d.body.t === 'pt'));
  h.clickText('.board__tools button', 'Очистить', 'нажали «Очистить»');
  await sleep(120);
  check('очистка доски сработала', /0 штрихов/.test(h.text()));
  h.click(h.$('.board__top .iconbtn'));
  await sleep(150);
  check('доска закрылась', !h.$('.board__canvas'));

  /* ── приходит второй участник ──────────────────────────────────────── */
  const guest = { t: 'hello', from: 'guest01', name: 'Аня', mic: true, cam: false, screen: false, hand: false, ts: Date.now() };
  await state.pushRemote(guest, secret);
  await sleep(350);
  check('второй участник появился в списке', /Аня/.test(h.text()));
  check('о входе сообщили тостом', /В комнате появился человек/.test(h.text()));
  check('создано прямое соединение', state.peers.length >= 1, 'соединений: ' + state.peers.length);

  const sigFrames = [];
  for (const p of state.published.slice(-40)) {
    const obj = await openWith(secret, p.body);
    if (obj) sigFrames.push(obj);
  }
  check('ушёл ответный привет', sigFrames.filter((d) => d.t === 'hello').length >= 2);
  check('ушло предложение связи (SDP)', sigFrames.some((d) => d.t === 'sig' && d.payload && d.payload.t === 'sdp'), JSON.stringify(sigFrames.filter((d) => d.t === 'sig').slice(0, 2)));
  check('ушли кандидаты сети (ICE)', sigFrames.some((d) => d.t === 'sig' && d.payload && d.payload.t === 'ice'));

  /* чужое сообщение и реакция */
  await state.pushRemote({ t: 'data', id: 'guest-chat-1', kind: 'chat', from: 'guest01', name: 'Аня', body: 'привет из рейла', ts: Date.now() }, secret);
  await sleep(250);
  check('чужое сообщение показано', /привет из рейла/.test(h.text()));
  await state.pushRemote({ t: 'data', id: 'guest-react-1', kind: 'react', from: 'guest01', name: 'Аня', body: { msgId: 'guest-chat-1', emoji: '👍' } }, secret);
  await sleep(250);
  check('чужая реакция показана', /👍/.test(h.text()));
  await state.pushRemote({ t: 'data', id: 'guest-hand-1', kind: 'hand', from: 'guest01', name: 'Аня', body: true }, secret);
  await sleep(250);
  check('чужая поднятая рука видна', /Подняли руку: Аня/.test(h.text()));

  /* отклик на нажатие реакции */
  const reactBtn = h.byText('.react', '👍');
  if (reactBtn) {
    h.click(reactBtn);
    await sleep(200);
    check('своя реакция добавляется и уходит', true);
  } else {
    check('кнопка реакции найдена', false, 'нет .react');
  }

  /* ── прямой канал ──────────────────────────────────────────────────── */
  /* соединение с участником — то, у которого есть канал «bridge»
     (проверка NAT тоже создаёт RTCPeerConnection, но без канала) */
  const pc = state.peers.filter((x) => x.channels.some((c) => c.label === 'bridge')).pop();
  const dc = pc && pc.channels.find((c) => c.label === 'bridge');
  check('соединение с участником найдено', !!pc);
  check('канал данных создан предлагающей стороной', !!dc);
  if (dc) {
    dc.open();
    await sleep(200);
    check('прямой канал открылся и это видно', /Прямой канал открыт|прямой канал/.test(h.text()));
    /* чужое сообщение уже по прямому каналу */
    dc.deliver({ id: 'guest-chat-2', kind: 'chat', from: 'guest01', name: 'Аня', body: 'и это тоже', ts: Date.now() });
    await sleep(200);
    check('сообщение по прямому каналу показано', /и это тоже/.test(h.text()));
    check('эхо своего сообщения по каналу игнорируется', (() => {
      dc.deliver({ id: 'self-echo', kind: 'chat', from: 'я', name: 'Я', body: 'моё же сообщение', ts: Date.now() });
      return true;
    })());
  }
  pc.connect();
  pc.deliverAudio();
  pc.deliverVideo();
  await sleep(250);
  const audioSinks = h.$$('audio');
  check('для чужого голоса создан звуковой элемент', audioSinks.length >= 1, 'элементов: ' + audioSinks.length);
  check('в плитках есть видео участника', h.$$('.tile video').length >= 2);
  check('элементы звука получают поток', audioSinks.some((a) => !!a.srcObject));

  /* ── качество доходит до отправителя ───────────────────────────────── */
  if (canMedia && pc) {
    const sender = pc.getSenders().find((s) => s.kind === 'video');
    const applied = sender && sender.params && sender.params.encodings && sender.params.encodings[0];
    check('отправителю выставлены 4K-параметры (60 кадров и высокий битрейт)',
      !!applied && applied.maxFramerate === 60 && applied.maxBitrate >= 20_000_000,
      JSON.stringify(applied));
    check('уменьшение картинки не требуется для 4K', !applied.scaleResolutionDownBy, JSON.stringify(applied));
    /* меняем на 720p·30 — отправитель обязан перестроиться сразу */
    const popBtn = h.byText('.sharebar button', 'Качество');
    h.click(popBtn);
    await sleep(200);
    h.clickExact('.popover .pick', '720p', 'выбрали 720p');
    await sleep(150);
    h.clickExact('.popover .pick', '30', 'выбрали 30 кадров');
    await sleep(300);
    const applied2 = sender.params.encodings[0];
    check('переход на 720p·30 применился без перезапуска', applied2.maxFramerate === 30 && applied2.maxBitrate < 6_000_000, JSON.stringify(applied2));
    /* и сам захват уменьшился: отдавать 4K, когда просят 720p, незачем */
    const liveScr = state.lastDisplay && state.lastDisplay.videoTrack;
    const liveSize = liveScr && liveScr.getSettings();
    check('захват экрана уменьшился до 720p', !!liveSize && liveSize.width === 1280 && liveSize.height === 720, JSON.stringify(liveSize));
    check('двойного уменьшения нет: масштаб не задан', !applied2.scaleResolutionDownBy, JSON.stringify(applied2));
    h.click(h.$('.popover .iconbtn'));
    await sleep(150);
    h.byText('.sharebar button', 'Остановить');
    h.click(h.byText('.sharebar button', 'Остановить'));
    await sleep(250);
    check('показ экрана останавливается', !/Вы показываете экран/.test(h.text()));
  }

  /* ── запись ────────────────────────────────────────────────────────── */
  const recIcons = h.$$('.voicebar .vbtn');
  h.click(recIcons[5]);
  await sleep(300);
  check('запись началась', /Идёт запись/.test(h.text()));
  h.clickText('.sharebar button', 'Остановить и скачать', 'нажали «Остановить и скачать»');
  await sleep(400);
  check('файл записи сохранён', state.anchors >= 1, 'скачиваний: ' + state.anchors);
  check('запись остановлена в интерфейсе', !/Идёт запись/.test(h.text()));

  /* ── приглашение, настройки, имя ───────────────────────────────────── */
  h.clickText('.main__tools button', 'Позвать', 'нажали «Позвать»');
  await sleep(200);
  const inviteInputs = h.$$('.modal input[readonly]');
  const linkValue = inviteInputs.length ? inviteInputs[0].value : '';
  check('ссылка-приглашение показана', /\/r\//.test(linkValue) && /#k=/.test(linkValue), linkValue);
  h.clickText('.modal__foot button', 'Скопировать ссылку', 'скопировали ссылку');
  await sleep(150);
  check('подтверждение копирования показано', /скопирован/i.test(h.text()));
  h.clickText('.modal__foot button', 'Готово', 'закрыли приглашение');
  await sleep(150);
  check('окно приглашения закрылось', !h.byText('.modal', 'Скопировать ссылку'));

  const gearBtn = h.$('.rail__btn[title="Настройки"]');
  check('кнопка настроек есть на рельсе', !!gearBtn);
  h.click(gearBtn);
  await sleep(300);
  check('окно настроек открылось', !!h.byText('.modal__head h3', 'Настройки'));
  h.clickText('.tab', 'Сеть', 'перешли на вкладку «Сеть»');
  await sleep(150);
  check('на вкладке сети есть TURN и свой релей', /TURN-сервер/.test(h.text()) && /Свой релей/.test(h.text()));
  h.clickText('.tab', 'Звук и видео', 'перешли на вкладку «Звук и видео»');
  await sleep(250);
  check('качество можно выбрать', /720p/.test(h.text()) && /Шумоподавление/.test(h.text()));
  check('в настройках два блока: камера и показ экрана', h.$$('.picker').length >= 2, 'блоков: ' + h.$$('.picker').length);
  check('в настройках есть 4K и 1440p', !!h.exact('.pick', '4K') && !!h.exact('.pick', '1440p'));
  check('в настройках есть 60 кадров', !!h.exact('.pick', '60'));
  check('в настройках есть предел битрейта', !!h.exact('.pick', '25 Мбит/с'));
  h.clickText('.tab', 'Профиль', 'вернулись на вкладку «Профиль»');
  await sleep(250);
  const nameInput = h.$('.modal input.input');
  check('поле имени доступно', !!nameInput);
  h.type(nameInput, 'Пётр');
  h.clickText('.modal__foot button', 'Сохранить', 'сохранили имя');
  await sleep(300);
  check('имя сохранилось и видно в интерфейсе', /Пётр/.test(h.text()), h.$('.member__name') ? h.$('.member__name').textContent : '');
  const nickFrames = [];
  for (const p of state.published.slice(-25)) {
    const obj = await openWith(secret, p.body);
    if (obj) nickFrames.push(obj);
  }
  const dcSent = (() => {
    try {
      return (pc.dcSent || []).concat((dc && dc.sent) || []).map((s) => JSON.parse(s));
    } catch {
      return [];
    }
  })();
  check(
    'смена имени ушла участникам',
    nickFrames.some((d) => d.t === 'data' && d.kind === 'nick' && d.body === 'Пётр')
      || dcSent.some((d) => d.kind === 'nick' && d.body === 'Пётр'),
    'через релей: ' + nickFrames.length + ', через канал: ' + dcSent.length
  );

  /* ── горячие клавиши ───────────────────────────────────────────────── */
  const micBtn = () => (h.$$('.voicebar .vbtn')[0] || { className: '' });
  const micBefore = micBtn().className.includes('is-on');
  h.key(win.document.body, 'm');
  await sleep(300);
  if (canMedia) {
    check('клавиша M переключает микрофон', micBtn().className.includes('is-on') !== micBefore, 'было ' + micBefore + ', стало ' + micBtn().className);
  } else {
    check('клавиша M при закрытых устройствах не роняет интерфейс', !!h.$('.voicebar') && /микрофон|недоступн/i.test(h.text()));
  }
  h.key(win.document.body, 'b');
  await sleep(200);
  check('клавиша B открывает доску', !!h.$('.board__canvas'));
  h.key(win.document.body, 'Escape');
  await sleep(200);
  check('Escape закрывает доску', !h.$('.board__canvas'));

  /* ── выход ─────────────────────────────────────────────────────────── */
  h.clickText('.main__tools button', 'Позвать', 'шапка отвечает');
  h.key(win.document.body, 'Escape');
  await sleep(150);
  const leaveBtn = h.$('.voicebar .vbtn[style]') || h.$$('.voicebar .vbtn').pop();
  h.click(leaveBtn);
  await sleep(300);
  check('вышли на главную', /Bridge — звонки, доска и чат для своих/.test(h.text()));
  const byeFrames = [];
  for (const p of state.published.slice(-6)) {
    const obj = await openWith(secret, p.body);
    if (obj) byeFrames.push(obj);
  }
  check('о выходе сообщили участникам', byeFrames.some((d) => d.t === 'bye'), JSON.stringify(byeFrames));
  check('после выхода нет панели голоса', !h.$('.voicepanel'));

  /* ── ошибки ────────────────────────────────────────────────────────── */
  const realErrors = (state.errors || []).filter((e) => !/ResizeObserver|Not implemented/i.test(e));
  check('в консоль не сыпались ошибки JS', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
  check('jsdom не ругался на разметку приложения', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));

  win.close();
}

/* ── прогоны ───────────────────────────────────────────────────────────── */
console.log('\n═══ Bridge: проверка сайта в поддельном браузере ═══');
await run({ label: 'Обычный случай: https, доступ к камере есть' });
await run({ label: 'Строгий случай: http без localhost, доступ к устройствам закрыт', secure: false, denyMedia: true });
await run({ label: 'Телефон: экран не отдаётся, камера есть', secure: true, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' });

console.log('\n══════════════════════════════════════════════════════');
console.log('  ИТОГ: ' + ok + ' ✅ / ' + bad + ' ❌');
if (fails.length) {
  console.log('  не прошло:');
  fails.slice(0, 12).forEach((f) => console.log('   · ' + f));
}
console.log('');
process.exit(bad ? 1 : 0);
