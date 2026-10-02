/**
 * Шифрование сигналинга.
 *
 * Идея простая: релей (публичный или свой) видит только непрозрачные двоичные
 * блоки. Ключ живёт в ссылке-приглашении и никогда не уходит на сервер.
 * Схема — AES-GCM 256, ключ выводится из секрета комнаты, у каждого кадра
 * свой вектор и счётчик, поэтому повторы и перестановки не проходят.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

const keyCache = new Map();

/** Секрет комнаты: 22 символа base64url = 128 бит случайности. */
export function randomSecret() {
  const arr = new Uint8Array(16);
  if (globalThis.crypto && globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(arr);
  else for (let i = 0; i < 16; i++) arr[i] = Math.floor(Math.random() * 256);
  return b64u(arr);
}

function b64u(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  const b = typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
  return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64u(str) {
  const s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary');
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

/** Короткий отпечаток (для темы релея и для сверки ключа глазами). */
export async function fingerprint(secret) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode('bridge|' + secret));
  const bytes = new Uint8Array(digest).slice(0, 5);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Тема публичного релея: имена комнат на сервере не видны, только хеш. */
export async function topicFor(room, secret) {
  const slug = String(room || 'общий')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24) || 'room';
  const fp = await fingerprint(secret || 'public');
  return ('bridge-' + slug + '-' + fp).slice(0, 64);
}

async function keyFor(secret) {
  const s = String(secret || '');
  if (!s) throw new Error('нет секрета комнаты');
  if (keyCache.has(s)) return keyCache.get(s);
  const raw = await crypto.subtle.digest('SHA-256', enc.encode('bridge-call|' + s));
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  keyCache.set(s, key);
  return key;
}

/**
 * Запечатать объект. Возвращает строку — её и кладём в тело сообщения релея.
 * Счётчик нужен только для различия кадров: он не секрет.
 */
export async function seal(secret, obj, counter = 0) {
  const key = await keyFor(secret);
  const iv = new Uint8Array(12);
  if (globalThis.crypto && globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(iv);
  else for (let i = 0; i < 12; i++) iv[i] = Math.floor(Math.random() * 256);
  iv[0] = 0; // оставляем место для счётчика, чтобы iv всегда читался одинаково
  const c = counter >>> 0;
  iv[1] = (c >>> 24) & 255;
  iv[2] = (c >>> 16) & 255;
  iv[3] = (c >>> 8) & 255;
  iv[4] = c & 255;
  const data = enc.encode(JSON.stringify(obj));
  const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  const out = new Uint8Array(12 + buf.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(buf), 12);
  return 'b1.' + b64u(out);
}

/** Распечатать кадр. Битый, чужой или подделанный кадр просто вернёт null. */
export async function open(secret, str) {
  try {
    const s = String(str || '').trim();
    if (!s.startsWith('b1.')) return null;
    const raw = unb64u(s.slice(3));
    if (raw.length < 13) return null;
    const key = await keyFor(secret);
    const iv = raw.slice(0, 12);
    const body = raw.slice(12);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, body);
    return JSON.parse(dec.decode(plain));
  } catch {
    return null;
  }
}
