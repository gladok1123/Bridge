/**
 * Bridge — мелкие помощники, которые работают и в браузере, и в Node.
 * Здесь нет ни React, ни обращений к DOM: файл спокойно импортируется тестами.
 */

/* ── строки и коды ─────────────────────────────────────────────────────── */

/** Код комнаты: только строчные буквы, цифры и дефис. */
export function normalizeRoom(raw, fallback = 'общий') {
  const s = String(raw == null ? '' : raw)
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9а-яё-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return s || fallback;
}

/** Человеческий код комнаты: две пары по три знака, без похожих букв. */
export function makeRoomCode() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const pick = (n) => Array.from({ length: n }, () => abc[Math.floor(Math.random() * abc.length)]).join('');
  return pick(3) + '-' + pick(3);
}

/** Короткий идентификатор (используется для участника и его «плеча» в сети). */
export function shortId(bytes = 5) {
  const arr = new Uint8Array(bytes);
  if (globalThis.crypto && globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(arr);
  else for (let i = 0; i < bytes; i++) arr[i] = Math.floor(Math.random() * 256);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Имя по умолчанию: «Гость·4821» — узнаваемо, но ничего не выдаёт. */
export function defaultName() {
  return 'Гость·' + Math.floor(1000 + Math.random() * 8999);
}

export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

export function firstLetter(name) {
  const s = String(name || '?').trim();
  const ch = Array.from(s)[0] || '?';
  return ch.toUpperCase();
}

/* ── аватары ───────────────────────────────────────────────────────────── */

/** Стабильный оттенок по имени: один и тот же человек — один и тот же цвет. */
export function hueOf(name) {
  const s = String(name || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

/** Стиль кружка с буквой: два тона, чтобы было живое, но не пёстро. */
export function avatarStyle(name) {
  const h = hueOf(name);
  return {
    background: `linear-gradient(135deg, hsl(${h} 62% 46%), hsl(${(h + 26) % 360} 58% 38%))`,
  };
}

/* ── время и числа ─────────────────────────────────────────────────────── */

export function fmtClock(ts) {
  const d = ts instanceof Date ? ts : new Date(ts || Date.now());
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export function fmtDay(ts) {
  const d = ts instanceof Date ? ts : new Date(ts || Date.now());
  const today = new Date();
  const same = d.toDateString() === today.toDateString();
  if (same) return 'сегодня';
  if (d.getFullYear() !== today.getFullYear()) return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

export function fmtDuration(ms) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h) return h + ' ч ' + (m % 60) + ' мин';
  if (m) return m + ' мин ' + (s % 60) + ' с';
  return s + ' с';
}

export function fmtBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return v + ' Б';
  if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' КБ';
  if (v < 1024 * 1024 * 1024) return (v / 1024 / 1024).toFixed(1) + ' МБ';
  return (v / 1024 / 1024 / 1024).toFixed(2) + ' ГБ';
}

export function fmtBitrate(bps) {
  const v = Number(bps) || 0;
  if (!v) return '—';
  if (v < 1000) return Math.round(v) + ' бит/с';
  if (v < 1000 * 1000) return (v / 1000).toFixed(0) + ' кбит/с';
  return (v / 1000 / 1000).toFixed(1) + ' Мбит/с';
}

/* ── мелочи ────────────────────────────────────────────────────────────── */

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function debounce(fn, ms = 250) {
  let t = 0;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Сливаем классы без зависимостей. */
export function cn(...parts) {
  return parts.filter(Boolean).join(' ');
}

/** Обрезаем длинный текст до предела, не рвя слово посередине. */
export function cut(text, max = 120) {
  const s = String(text || '');
  if (s.length <= max) return s;
  let head = s.slice(0, max);
  const boundary = s[max];
  /* если обрыв пришёлся на середину слова — отступаем к его началу */
  if (boundary && !/\s/.test(boundary)) head = head.replace(/\s*\S*$/, '');
  return head.replace(/\s+$/, '') + '…';
}

/** Разбор вставленной ссылки на комнату: понимает /r/код, ?room=код и «просто код». */
export function roomFromInput(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const m = s.match(/[?&]room=([^&#\s]+)/i) || s.match(/\/r\/([^/?#\s]+)/i) || s.match(/^#([^\s]+)$/);
  const code = m ? decodeURIComponent(m[1]) : s;
  return normalizeRoom(code, '');
}

/** Хост из чего угодно — для подсказок и диагностики. */
export function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

export function isSecure() {
  if (typeof window === 'undefined') return true;
  if (window.isSecureContext) return true;
  const h = (window.location && window.location.hostname) || '';
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost');
}

/* ── хранение настроек (безопасно вне браузера) ────────────────────────── */

const LS = 'bridge.settings.v1';
const SS = 'bridge.session.v1';

export function loadJSON(key, def) {
  try {
    if (typeof localStorage === 'undefined') return def;
    const raw = localStorage.getItem(key);
    if (!raw) return def;
    const v = JSON.parse(raw);
    return v == null ? def : v;
  } catch {
    return def;
  }
}

export function saveJSON(key, value) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* приватный режим — просто не сохраняем */
  }
}

export const store = {
  get settings() {
    return loadJSON(LS, {});
  },
  set settings(v) {
    saveJSON(LS, v);
  },
  get session() {
    try {
      if (typeof sessionStorage === 'undefined') return null;
      const raw = sessionStorage.getItem(SS);
      const v = raw ? JSON.parse(raw) : null;
      // сессия живёт час: чтобы «обновить страницу» не выкидывало, но и не висело вечно
      if (!v || !v.at || Date.now() - v.at > 3600e3) return null;
      return v;
    } catch {
      return null;
    }
  },
  set session(v) {
    try {
      if (typeof sessionStorage === 'undefined') return;
      if (v) sessionStorage.setItem(SS, JSON.stringify({ ...v, at: Date.now() }));
      else sessionStorage.removeItem(SS);
    } catch {
      /* ничего */
    }
  },
};

/**
 * Разбор строки TURN/STUN из настроек.
 * Формат TURN: turn:host:3478|логин|пароль. Можно несколько строк через запятую.
 */
export function parseIceServers({ stun = '', turn = '' } = {}) {
  const out = [];
  String(stun || '')
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((url) => out.push({ urls: url }));
  String(turn || '')
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((line) => {
      const parts = line.split('|').map((p) => p.trim());
      const urls = parts[0].split(/\s+/).filter(Boolean);
      if (!urls.length) return;
      const item = { urls: urls.length === 1 ? urls[0] : urls };
      if (parts[1]) item.username = parts[1];
      if (parts[2]) item.credential = parts[2];
      out.push(item);
    });
  return out;
}

export const DEFAULT_SETTINGS = {
  name: '',
  av: '',                       // «плечо» участника — выдаётся при входе
  stun: 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302',
  turn: '',
  relay: '',                    // свой релей; пусто — публичный из окружения
  mic: true,
  cam: false,
  noiseSuppress: true,
  echoCancel: true,
  autoGain: true,
  /* Камера: 360 | 480 | 720 | 1080 | 1440 | 2160, кадры 15 | 24 | 30 | 60 */
  camQuality: '720',
  camFps: '30',
  camBitrate: 0,                // 0 — авто
  /* Показ экрана: своё разрешение, кадры, предел и оптимизация */
  screenQuality: '1080',
  screenFps: '30',
  screenBitrate: 0,
  streamHint: 'auto',           // auto | text | motion
  videoQuality: '720',          // старые ключи: оставлены, чтобы настройки не сбрасывались
  fps: '30',
  chatSize: 'md',               // sm | md | lg
  membersOpen: true,
  showStats: false,
  shareAudio: false,
  theme: 'dark',
};
