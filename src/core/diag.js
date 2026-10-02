/**
 * Проверка связи Bridge: построчно показывает, что в порядке, а что нет,
 * и что с этим делать. Никаких «что-то пошло не так» — только причины.
 */
import { canShareScreen, isSecure, listDevices } from './media.js';
import { fingerprint } from '../lib/crypto.js';

export const STATES = {
  ok: { label: 'в порядке', tone: 'ok' },
  warn: { label: 'с оговоркой', tone: 'warn' },
  bad: { label: 'не работает', tone: 'bad' },
  wait: { label: 'проверяю', tone: 'wait' },
};

function row(id, name, detail, state = 'wait', hint = '') {
  return { id, name, detail, state, hint };
}

/** Быстрая проверка без сети: то, что зависит только от браузера и адреса. */
export async function localChecks() {
  const secure = isSecure();
  const devices = await listDevices();
  const screen = canShareScreen();
  const mob = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  const rows = [
    row(
      'secure',
      'Защищённое соединение',
      secure ? 'адрес https или localhost — камера разрешена' : 'адрес открыт по http: браузер не даст камеру',
      secure ? 'ok' : 'bad',
      secure ? '' : 'Откройте сайт по https или зайдите с самого сервера через localhost'
    ),
    row(
      'devices',
      'Камера и микрофон',
      devices.ok ? `найдено: камера ${devices.cam} · микрофон ${devices.mic}` : 'браузер не отдаёт список устройств',
      devices.ok && (devices.cam || devices.mic) ? (devices.cam && devices.mic ? 'ok' : 'warn') : 'bad',
      devices.ok && !devices.cam ? 'Камеры не видно — работать можно только со звуком' : ''
    ),
    row(
      'screen',
      'Демонстрация экрана',
      screen
        ? (mob ? 'браузер умеет, но на телефоне часто недоступна' : 'браузер умеет показывать экран')
        : 'браузер не поддерживает показ экрана',
      screen ? (mob ? 'warn' : 'ok') : 'bad',
      screen ? (mob ? 'С телефона показывайте с компьютера или включите камеру' : '') : 'Показ экрана есть в Chrome, Edge, Firefox и Safari на компьютере'
    ),
    row('webrtc', 'Соединение напрямую', typeof RTCPeerConnection !== 'undefined' ? 'WebRTC доступен' : 'браузер без WebRTC', typeof RTCPeerConnection !== 'undefined' ? 'ok' : 'bad'),
    row('record', 'Запись разговора', typeof MediaRecorder !== 'undefined' ? 'запись поддерживается' : 'браузер не умеет запись', typeof MediaRecorder !== 'undefined' ? 'ok' : 'warn'),
  ];
  return rows;
}

/** Проверка сети: релей, шифрование, STUN и «дырка» в NAT. */
export async function networkChecks({ relay, room, secret, iceServers, onRow } = {}) {
  const rows = [];
  const push = (r) => {
    rows.push(r);
    if (onRow) onRow(r, rows.slice());
  };

  /* релей */
  const st = relay && relay.status ? relay.status : null;
  push(
    row(
      'relay',
      'Релей знакомства',
      st
        ? (st.ok
          ? `на связи: ${st.mode === 'ws' ? 'свой сокет' : 'публичный'} · ${st.base || ''} · отправлено ${st.sent}, принято ${st.got}`
          : `молчит: ${st.error || 'нет ответа'}, попыток ${st.tries || 0}`)
        : 'не запущен',
      st ? (st.ok ? 'ok' : 'warn') : 'wait',
      st && !st.ok ? 'Проверьте интернет; при блокировке укажите свой релей в настройках' : ''
    )
  );

  /* ключ комнаты */
  if (secret) {
    const fp = await fingerprint(secret);
    push(row('key', 'Шифрование комнаты', `ключ на месте, отпечаток ${fp}`, 'ok', 'Такой же отпечаток должен быть у друзей — сравните глазами'));
  } else {
    push(row('key', 'Шифрование комнаты', 'секрет не найден: ссылка была без ключа', 'warn', 'Войдите по полной ссылке-приглашению'));
  }

  /* STUN/TURN: собираем кандидатов и смотрим, нашёлся ли внешний адрес */
  const n = await probeIce(iceServers);
  push(
    row(
      'ice',
      'Проход через NAT',
      n.srflx
        ? `внешний адрес получен (${n.srflx})`
        : n.host
          ? 'виден только локальный адрес — собеседник из другой сети может не подключиться'
          : 'не удалось собрать адреса',
      n.srflx ? 'ok' : n.host ? 'warn' : 'bad',
      n.srflx ? '' : 'Добавьте TURN-сервер в настройках: без него часть сетей не пропускает прямой звонок'
    )
  );
  if (n.relay) push(row('turn', 'TURN-сервер', 'через него тоже есть путь', 'ok'));
  return rows;
}

/** Собрать ICE-кандидатов и понять, какой тип связи доступен. */
export function probeIce(iceServers, timeout = 4000) {
  return new Promise((resolve) => {
    const out = { host: '', srflx: '', relay: '' };
    if (typeof RTCPeerConnection === 'undefined') return resolve(out);
    let pc;
    try {
      pc = new RTCPeerConnection({ iceServers: iceServers || [] });
    } catch {
      return resolve(out);
    }
    const done = () => {
      try {
        pc.close();
      } catch {
        /* уже */
      }
      resolve(out);
    };
    const timer = setTimeout(done, timeout);
    pc.onicecandidate = (ev) => {
      const c = ev.candidate;
      if (!c) {
        clearTimeout(timer);
        return done();
      }
      const type = c.type || '';
      const addr = c.address || (c.candidate || '').split(' ')[4] || '';
      if (type === 'host' && !out.host) out.host = addr;
      if (type === 'srflx' && !out.srflx) out.srflx = addr;
      if (type === 'relay' && !out.relay) out.relay = addr;
    };
    try {
      pc.createDataChannel('probe');
      pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(done);
    } catch {
      done();
    }
  });
}

/** Итог проверки: одна строка для шапки. */
export function worst(rows) {
  if (!rows || !rows.length) return 'wait';
  if (rows.some((r) => r.state === 'bad')) return 'bad';
  if (rows.some((r) => r.state === 'warn')) return 'warn';
  if (rows.some((r) => r.state === 'wait')) return 'wait';
  return 'ok';
}
