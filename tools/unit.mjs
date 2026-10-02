#!/usr/bin/env node
/**
 * Проверки Bridge без браузера: логика комнаты, доска, шифрование, утилиты
 * и собственный релей. Запуск:  node tools/unit.mjs
 */
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Импорт модуля приложения. Важно: путь сначала превращается в file:// —
 * иначе на Windows модуль не подхватывается (диск «C:» не считается схемой).
 */
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

let ok = 0;
let bad = 0;
const fails = [];

function check(name, cond, extra = '') {
  if (cond) {
    ok++;
    console.log('  ✅ ' + name);
  } else {
    bad++;
    fails.push(name + (extra ? ' → ' + extra : ''));
    console.log('  ❌ ' + name + (extra ? ' → ' + extra : ''));
  }
}

function eq(name, got, want) {
  check(name, JSON.stringify(got) === JSON.stringify(want), 'получено ' + JSON.stringify(got) + ', ждали ' + JSON.stringify(want));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── импорт модулей приложения ─────────────────────────────────────────── */
const util = await load('src/lib/util.js');
const cryptoLib = await load('src/lib/crypto.js');
const board = await load('src/core/board.js');
const room = await load('src/core/room.js');
const media = await load('src/core/media.js');
const diag = await load('src/core/diag.js');
const icons = await load('src/lib/icons.js');

console.log('\n── Утилиты ───────────────────────────────────────────────');
eq('код комнаты приводится к нижнему регистру и дефисам', util.normalizeRoom('Моя Комната 7'), 'моя-комната-7');
eq('мусорные символы вычищаются', util.normalizeRoom('a!!!b@@c', 'общий'), 'abc');
eq('пустое значение даёт запасной код', util.normalizeRoom('', 'общий'), 'общий');
check('сгенерированный код вида abc-123', /^[a-z0-9]{3}-[a-z0-9]{3}$/.test(util.makeRoomCode()), util.makeRoomCode());
eq('ссылка /r/код распознаётся', util.roomFromInput('https://bridge.example/r/team-7#k=abc'), 'team-7');
eq('ссылка с ?room= распознаётся', util.roomFromInput('https://x.y/?room=Зал'), 'зал');
eq('просто код распознаётся', util.roomFromInput('  MyRoom '), 'myroom');
eq('хэш-ссылка распознаётся', util.roomFromInput('#zhivo'), 'zhivo');
check('короткий идентификатор уникален', util.shortId(5) !== util.shortId(5));
eq('обрезка текста с сохранением слов', util.cut('раз два три четыре пять', 12), 'раз два три…');
eq('короткий текст не трогаем', util.cut('коротко', 20), 'коротко');
eq('одно длинное слово обрезается целиком', util.cut('оченьдлинноесловобезпробелов', 10), 'оченьдлинноесловобезпробелов'.slice(0, 10).replace(/\s*\S*$/, '') + '…');
eq('байты форматируются', util.fmtBytes(2048), '2.0 КБ');
eq('битрейт форматируется', util.fmtBitrate(1_500_000), '1.5 Мбит/с');
eq('длительность форматируется', util.fmtDuration(3 * 60_000 + 5000), '3 мин 5 с');
check('оттенок аватара стабилен', util.hueOf('Аня') === util.hueOf('Аня'), String(util.hueOf('Аня')));
check('разные имена — разные оттенки (в основном)', util.hueOf('Аня') !== util.hueOf('Пётр'));
check('первая буква берётся у кириллицы', util.firstLetter('аня') === 'А');

console.log('\n── Сеть: разбор настроек ─────────────────────────────────');
eq('STUN и TURN разбираются', util.parseIceServers({
  stun: 'stun:a:1, stun:b:2',
  turn: 'turn:h:3478|логин|пароль',
}), [
  { urls: 'stun:a:1' },
  { urls: 'stun:b:2' },
  { urls: 'turn:h:3478', username: 'логин', credential: 'пароль' },
]);
eq('несколько TURN в одной строке', util.parseIceServers({ turn: 'turn:x:1 turn:x:1?transport=tcp|u|p' }).length, 1);
eq('пустые настройки дают пустой список', util.parseIceServers({}), []);

console.log('\n── Шифрование сигналинга ─────────────────────────────────');
const secret = cryptoLib.randomSecret();
check('секрет отдаётся в base64url', /^[A-Za-z0-9_-]{20,}$/.test(secret), secret);
const topic = await cryptoLib.topicFor('Моя Комната', secret);
check('тема релея — допустимые символы', /^[-_A-Za-z0-9]{1,64}$/.test(topic), topic);
check('тема не содержит имени комнаты', !topic.includes('моя') && !topic.includes('комната'), topic);
const topic2 = await cryptoLib.topicFor('Моя Комната', secret);
check('тема стабильна для одного секрета', topic === topic2);
check('другой секрет — другая тема', topic !== (await cryptoLib.topicFor('Моя Комната', 'другой-секрет')));
const fp = await cryptoLib.fingerprint(secret);
check('отпечаток ключа — 10 знаков', /^[0-9a-f]{10}$/.test(fp), fp);
const sealed = await cryptoLib.seal(secret, { t: 'hello', from: 'abc', n: 42 });
check('кадр имеет свой префикс версии', sealed.startsWith('b1.'), sealed.slice(0, 12));
const opened = await cryptoLib.open(secret, sealed);
eq('кадр расшифровывается владельцем ключа', opened, { t: 'hello', from: 'abc', n: 42 });
eq('чужим ключом не расшифровывается', await cryptoLib.open('чужой-секрет', sealed), null);
const tampered = 'b1.' + Buffer.from(sealed.slice(3), 'base64url').map((b, i) => (i === 20 ? b ^ 0xff : b)) && 'b1.' + Buffer.from(
  Uint8Array.from(Buffer.from(sealed.slice(3), 'base64url'), (b, i) => (i === 20 ? b ^ 0xff : b))
).toString('base64url');
eq('подделанный кадр отбрасывается', await cryptoLib.open(secret, tampered), null);
eq('мусор вместо кадра не ломает приём', await cryptoLib.open(secret, 'привет'), null);
const s1 = await cryptoLib.seal(secret, { a: 1 }, 1);
const s2 = await cryptoLib.seal(secret, { a: 1 }, 2);
check('два кадра с одним содержимым различаются (разный вектор)', s1 !== s2);

console.log('\n── Доска ─────────────────────────────────────────────────');
const b = new board.BoardStore();
check('пустая доска', b.size === 0 && b.points === 0);
check('первая точка создаёт штрих', b.apply({ t: 'pt', sid: 's1', color: '#fff', w: 4, a: 'я', pts: [[0.1, 0.1]] }) && b.size === 1);
check('точки добавляются в тот же штрих', b.apply({ t: 'pt', sid: 's1', pts: [[0.2, 0.2], [0.3, 0.3]] }) && b.points === 3);
check('новый sid — новый штрих', b.apply({ t: 'pt', sid: 's2', pts: [[0.5, 0.5]] }) && b.size === 2);
check('мусорные точки игнорируются', !b.apply({ t: 'pt', sid: 's1', pts: [] }));
b.apply({ t: 'pt', sid: 's2', pts: [['x', 'y'], [2, -3], null] });
check('координаты вне диапазона подрезаются и NaN отбрасывается', b.strokes[1].pts.length === 2 && b.strokes[1].pts[1][0] === 1 && b.strokes[1].pts[1][1] === 0);
check('отмена убирает последний штрих', b.apply({ t: 'undo' }) && b.size === 1);
check('очистка стирает всё', b.apply({ t: 'clear' }) && b.size === 0);
b.apply({ t: 'pt', sid: 's3', color: '#f00', w: 7, a: 'друг', pts: [[0.4, 0.4], [0.6, 0.6]] });
const snap = b.snapshot();
eq('снимок содержит штрихи', snap.t, 'snap');
check('в снимке есть координаты', snap.strokes[0].pts.length === 2);
const b2 = new board.BoardStore();
check('снимок применяется у другого участника', b2.apply(snap) && b2.size === 1 && b2.points === 2);
const calls = [];
const fakeCtx = {
  clearRect: () => calls.push('clear'),
  beginPath: () => calls.push('begin'),
  moveTo: () => calls.push('move'),
  lineTo: () => calls.push('line'),
  arc: () => calls.push('arc'),
  fill: () => calls.push('fill'),
  stroke: () => calls.push('stroke'),
};
eq('рисование отдаёт число штрихов', board.renderBoard(fakeCtx, b2.strokes, { width: 800, height: 600 }), 1);
check('рисование действительно трогает холст', calls.includes('stroke') && calls.includes('clear'));
check('номер штриха привязан к участнику', board.strokeId('abc', 1) === 'abc-1' && board.strokeId('abc', 1) !== board.strokeId('def', 1));

console.log('\n── Состояние комнаты ─────────────────────────────────────');
let st = room.createRoomState();
st = room.roomReduce(st, { type: 'hello', av: 'p1', name: 'Аня', mic: true, cam: false });
check('участник появился', room.peerList(st).length === 1 && st.peers.p1.name === 'Аня');
check('о входе написано в чате', st.chat.length === 1 && st.chat[0].kind === 'system');
st = room.roomReduce(st, { type: 'hello', av: 'p1', name: 'Аня', mic: false });
check('повторное приветствие не дублирует участника и не спамит', room.peerList(st).length === 1 && st.chat.length === 1);
check('состояние микрофона обновилось', st.peers.p1.mic === false);
st = room.roomReduce(st, { type: 'chat', id: 'm1', from: 'p1', name: 'Аня', text: 'привет', ts: Date.now() });
check('сообщение добавилось', st.chat.length === 2 && st.chat[1].text === 'привет');
const before = st.chat.length;
st = room.roomReduce(st, { type: 'chat', id: 'm1', from: 'p1', name: 'Аня', text: 'привет', ts: Date.now() });
check('повтор сообщения (эхо релея) не дублируется', st.chat.length === before);
st = room.roomReduce(st, { type: 'react', id: 'm1', emoji: '👍', av: 'p2' });
check('реакция добавилась', (st.chat.find((m) => m.id === 'm1').reacts['👍'] || []).length === 1);
st = room.roomReduce(st, { type: 'react', id: 'm1', emoji: '👍', av: 'p2' });
check('повторная реакция того же человека снимается', !st.chat.find((m) => m.id === 'm1').reacts['👍']);
st = room.roomReduce(st, { type: 'media', av: 'p1', hand: true, screen: true });
check('рука и показ экрана учтены', st.peers.p1.hand === true && st.peers.p1.screen === true);
st = room.roomReduce(st, { type: 'nick', av: 'p1', name: 'Аня М.' });
check('переименование доходит', st.peers.p1.name === 'Аня М.');
const counts = room.countState(st);
check('счётчик учитывает себя', counts.total === 2, JSON.stringify(counts));
st = room.roomReduce(st, { type: 'prune', now: Date.now() + 60_000 });
check('молчащий участник вычищается по таймауту', room.peerList(st).length === 0);
check('о пропаже написано', st.chat.some((m) => /пропал/.test(m.text)));
st = room.roomReduce(st, { type: 'bye', av: 'нет-такого' });
check('прощание незнакомца ничего не ломает', st.chat.length > 0);
let long = room.createRoomState();
for (let i = 0; i < 400; i++) long = room.roomReduce(long, { type: 'chat', id: 'x' + i, from: 'p', name: 'П', text: 'т' + i });
check('история чата подрезается по пределу', long.chat.length <= 300, String(long.chat.length));

console.log('\n── Медиа ─────────────────────────────────────────────────');
eq('отказ в доступе объясняется понятно', media.explainError({ name: 'NotAllowedError' }), 'denied');
eq('занятое устройство объясняется понятно', media.explainError({ name: 'NotReadableError' }), 'busy');
eq('отсутствие устройства объясняется понятно', media.explainError({ name: 'NotFoundError' }), 'notfound');
check('у каждой ошибки есть текст', Object.values(media.MEDIA_ERRORS).every((t) => t.length > 20));
check('качества перечислены', Object.keys(media.QUALITY).join(',') === '360,480,720,1080,1440,2160', Object.keys(media.QUALITY).join(','));
check('частоты кадров разумные', media.FPS_CHOICES.includes(30) && media.FPS_CHOICES.length === 4);

console.log('\n── Качество видео (до 4K и 60 кадров) ───────────────────');
const q = media.QUALITY;
check('разрешений шесть, включая 1440p и 4K', ['360', '480', '720', '1080', '1440', '2160'].every((k) => q[k]), Object.keys(q).join(','));
eq('4K — это 3840×2160', [q['2160'].w, q['2160'].h], [3840, 2160]);
check('кадры: 15, 24, 30 и 60', media.FPS_CHOICES.join(',') === '15,24,30,60', media.FPS_CHOICES.join(','));
check('в битрейтах есть «Авто» и 40 Мбит/с', media.BITRATE_CHOICES[0].value === 0 && media.BITRATE_CHOICES.some((b) => b.value === 40_000_000));
check('есть три варианта оптимизации', media.HINT_CHOICES.map((h) => h.value).join(',') === 'auto,text,motion');
const b4k = media.autoBitrate({ quality: 2160, fps: 60, kind: 'screen' });
check('4K·60 просит много, но не больше предела', b4k >= 20_000_000 && b4k <= media.MAX_BITRATE, String(b4k));
const b1080 = media.autoBitrate({ quality: 1080, fps: 60, kind: 'screen' });
check('1080p·60 укладывается в привычные 8–14 Мбит/с', b1080 > 8_000_000 && b1080 < 14_000_000, String(b1080));
const b360 = media.autoBitrate({ quality: 360, fps: 15, kind: 'cam' });
check('360p·15 не опускается ниже минимума', b360 >= media.MIN_BITRATE, String(b360));
check('для текста битрейт выше, чем для движения', media.autoBitrate({ quality: 1080, fps: 30, kind: 'screen', hint: 'text' }) > media.autoBitrate({ quality: 1080, fps: 30, kind: 'screen', hint: 'motion' }));
check('камера просит меньше экрана при том же размере', media.autoBitrate({ quality: 1080, fps: 30, kind: 'cam' }) < media.autoBitrate({ quality: 1080, fps: 30, kind: 'screen' }));
eq('ручной предел перекрывает авто', media.preferredBitrate({ bitrate: 8_000_000, quality: 2160, fps: 60, kind: 'screen' }), 8_000_000);
eq('предел выше максимума подрезается', media.preferredBitrate({ bitrate: 999_000_000, quality: 720, fps: 30 }), media.MAX_BITRATE);
eq('4K → 1080p уменьшается вдвое', media.scaleFor({ width: 3840, height: 2160 }, 1080), 2);
eq('4K → 720p уменьшается втрое', media.scaleFor({ width: 3840, height: 2160 }, 720), 3);
eq('меньше цели не растягиваем', media.scaleFor({ width: 1280, height: 720 }, 1080), 1);
eq('без размеров масштаб не трогаем', media.scaleFor({}, 1080), 1);

/* живая проверка: применяются ли параметры к отправителю */
const applied = await media.tuneSender({
  setParameters(p) { this.p = p; return Promise.resolve(); },
  getParameters() { return { encodings: [{}] }; },
}, { kind: 'screen', quality: 2160, fps: 60, bitrate: 0, hint: 'text', track: { getSettings: () => ({ width: 3840, height: 2160 }), contentHint: '' } });
check('отправителю выставлены кадры и битрейт', applied && applied.maxFramerate === 60 && applied.maxBitrate >= 20_000_000, JSON.stringify(applied));
eq('картинка уменьшается по выбранному разрешению', applied && applied.scaleResolutionDownBy, 1);
const track2160 = { getSettings: () => ({ width: 3840, height: 2160 }), contentHint: '' };
const applied1080 = await media.tuneSender({
  setParameters(p) { this.p = p; return Promise.resolve(); },
  getParameters() { return { encodings: [{}] }; },
}, { kind: 'screen', quality: 1080, fps: 30, hint: 'text', track: track2160 });
eq('при 1080p картинка уменьшается вдвое', applied1080.scaleResolutionDownBy, 2);
eq('подсказка кодировщику — «текст»', track2160.contentHint, 'text');
const trackMotion = { getSettings: () => ({ width: 1280, height: 720 }), contentHint: '' };
await media.tuneSender({ setParameters() { return Promise.resolve(); }, getParameters() { return { encodings: [{}] }; } }, { kind: 'screen', quality: 720, fps: 60, hint: 'motion', track: trackMotion });
eq('для движения подсказка «motion»', trackMotion.contentHint, 'motion');
const trackCam = { getSettings: () => ({ width: 1280, height: 720 }), contentHint: '' };
await media.tuneSender({ setParameters() { return Promise.resolve(); }, getParameters() { return { encodings: [{}] }; } }, { kind: 'cam', quality: 720, fps: 30, track: trackCam });
eq('камера всегда «motion»', trackCam.contentHint, 'motion');
const retuned = { applyConstraints: null, calls: [], async applyConstraints(c) { this.calls.push(c); }, getSettings: () => ({ width: 640, height: 360 }) };
await media.retuneTrack(retuned, { quality: 1440, fps: 60 });
check('дорожка просит новое разрешение на ходу', retuned.calls.length === 1 && retuned.calls[0].width.ideal === 2560 && retuned.calls[0].frameRate.ideal === 60, JSON.stringify(retuned.calls[0]));

console.log('\n── Проверка связи ────────────────────────────────────────');
const rows = await diag.localChecks();
check('локальная проверка отдаёт строки', rows.length >= 5);
check('в строках есть разбор https и устройств', rows.some((r) => r.id === 'secure') && rows.some((r) => r.id === 'devices'));
eq('итог по пустому списку — «проверяю»', diag.worst([]), 'wait');
eq('итог по хорошим строкам — «в порядке»', diag.worst([{ state: 'ok' }, { state: 'ok' }]), 'ok');
eq('плохая строка перевешивает', diag.worst([{ state: 'ok' }, { state: 'bad' }]), 'bad');

console.log('\n── Иконки ────────────────────────────────────────────────');
check('набор иконок собран', icons.ICON_NAMES.length >= 45, String(icons.ICON_NAMES.length));
check('все иконки — непустые пути', icons.ICON_NAMES.every((n) => typeof icons.ICONS[n] === 'string' && icons.ICONS[n].length > 5));
check('иконки для звонка на месте', ['mic', 'micOff', 'video', 'videoOff', 'screen', 'phoneOff', 'hand', 'board', 'send'].every((n) => icons.ICONS[n]));

console.log('\n── Свой релей (живой прогон) ─────────────────────────────');
const { client } = await load('tools/ws-lite.js');
const port = 8091;
const relay = spawn(process.execPath, [path.join(ROOT, 'relay/server.js'), String(port)], { stdio: 'ignore' });
await sleep(600);
try {
  const health = await fetch('http://127.0.0.1:' + port + '/health').then((r) => r.json());
  check('релей отвечает на проверку здоровья', health.ok === true && health.service === 'bridge-relay');
  const a = client('ws://127.0.0.1:' + port + '/ws');
  const b = client('ws://127.0.0.1:' + port + '/ws');
  const c = client('ws://127.0.0.1:' + port + '/ws');
  await a.connect();
  await b.connect();
  await c.connect();
  const gotB = [];
  const gotC = [];
  const gotA = [];
  b.onText = (t) => gotB.push(t);
  c.onText = (t) => gotC.push(t);
  a.onText = (t) => gotA.push(t);
  a.send(JSON.stringify({ r: 'зал', hello: 1 }));
  b.send(JSON.stringify({ r: 'зал', hello: 1 }));
  c.send(JSON.stringify({ r: 'другая', hello: 1 }));
  await sleep(200);
  a.send(JSON.stringify({ r: 'зал', p: 'зашифрованный-кадр' }));
  await sleep(250);
  check('кадр дошёл до участника той же комнаты', gotB.length === 1 && gotB[0].includes('зашифрованный-кадр'), JSON.stringify(gotB));
  check('чужая комната ничего не получила', gotC.length === 0, JSON.stringify(gotC));
  check('своё эхо не вернулось', gotA.length === 0, JSON.stringify(gotA));
  b.send(JSON.stringify({ r: 'зал', p: 'ответный' }));
  await sleep(200);
  check('ответ дошёл до первого', gotA.length === 1 && gotA[0].includes('ответный'));
  const ping = [];
  a.onText = (t) => ping.push(t);
  a.send(JSON.stringify({ r: 'зал', ping: 1 }));
  await sleep(150);
  check('пульс получает ответ', ping.some((t) => t.includes('pong')), JSON.stringify(ping));
  a.close();
  b.close();
  c.close();
  await sleep(150);
  const after = await fetch('http://127.0.0.1:' + port + '/health').then((r) => r.json());
  check('комнаты освобождаются после отключения', after.rooms === 0, JSON.stringify(after));
} finally {
  relay.kill('SIGKILL');
}

console.log('\n══════════════════════════════════════════════════════════');
console.log('  ИТОГ: ' + ok + ' ✅ / ' + bad + ' ❌');
if (fails.length) {
  console.log('  не прошло:');
  fails.forEach((f) => console.log('   · ' + f));
}
console.log('');
process.exit(bad ? 1 : 0);
