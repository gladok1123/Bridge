/**
 * Настройки сборки. Всё, что начинается с NEXT_PUBLIC_, можно задать
 * в .env.local (локально) или в переменных окружения Vercel.
 */
const env = typeof process !== 'undefined' && process.env ? process.env : {};

export const ENV = {
  /** Публичный релей (ntfy-совместимый). По умолчанию ntfy.sh — работает без сервера. */
  relayUrl: (env.NEXT_PUBLIC_RELAY_URL || 'https://ntfy.sh').replace(/\/+$/, ''),
  /** Свой WebSocket-релей (npm run relay). Если задан — идёт первым, публичный остаётся резервом. */
  wsRelay: env.NEXT_PUBLIC_WS_RELAY || '',
  /** STUN-серверы через запятую. */
  stun: env.NEXT_PUBLIC_STUN || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302',
  /** TURN-сервер: turn:host:3478|логин|пароль (можно несколько через запятую). */
  turn: env.NEXT_PUBLIC_TURN || '',
};

/** Тема публичного релея собирается из кода комнаты — см. lib/crypto.js. */
export const LIMITS = {
  msgMax: 2000,
  nameMax: 40,
  roomMax: 40,
  boardHistory: 4000,
  chatHistory: 300,
  peersHint: 12,       // мягкий порог «полной сетки»
  iceServersMax: 8,
};

/** Публичные адреса приглашения: сайт, на котором мы сейчас работаем. */
export function siteOrigin() {
  if (typeof window === 'undefined') return '';
  return window.location.origin;
}
