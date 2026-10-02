/**
 * Состояние комнаты Bridge: кто в ней, что написано, что нарисовано.
 *
 * Всё описано чистой функцией roomReduce — значит, одинаково работает в браузере
 * и в тестах, без DOM и без React. Хук useBridge только подписывает это на сеть.
 */
import { LIMITS } from '../lib/config.js';

export const PEER_TIMEOUT = 22000;      // молчит дольше — считаем, что ушёл
export const BOARD_SENDER = 'board';    // служебный «отправитель» штрихов

export function createRoomState() {
  return {
    room: '',
    me: '',                              // наш «позывной» в комнате
    name: '',
    joinedAt: 0,
    peers: {},                           // позывной → { av, name, since, seen, mic, cam, screen, hand, muted }
    order: [],                           // порядок появления — чтобы список не прыгал
    chat: [],                            // [{ id, kind, from, name, text, ts, reacts: { '👍': [av] } }]
    board: null,                         // BoardStore (ставится снаружи)
    hand: false,
  };
}

/* ── участники ─────────────────────────────────────────────────────────── */

export function peerList(state) {
  return state.order.map((av) => state.peers[av]).filter(Boolean);
}

export function inCall(state) {
  return peerList(state).filter((p) => p.inCall !== false);
}

function upsertPeer(state, info) {
  const av = String(info.av || '');
  if (!av || av === state.me) return state;
  const prev = state.peers[av];
  const peer = {
    av,
    name: String(info.name || (prev && prev.name) || 'Гость'),
    since: (prev && prev.since) || Date.now(),
    seen: Date.now(),
    mic: info.mic !== undefined ? !!info.mic : (prev ? prev.mic : true),
    cam: info.cam !== undefined ? !!info.cam : (prev ? prev.cam : false),
    screen: info.screen !== undefined ? !!info.screen : (prev ? prev.screen : false),
    hand: info.hand !== undefined ? !!info.hand : (prev ? prev.hand : false),
    inCall: info.inCall !== undefined ? !!info.inCall : (prev ? prev.inCall : true),
    relay: info.relay || (prev && prev.relay) || '',
  };
  const peers = { ...state.peers, [av]: peer };
  const order = prev ? state.order : state.order.concat(av);
  return { ...state, peers, order, chat: prev ? state.chat : pushSys(state, info.name || peer.name, 'вошёл') };
}

/* ── чат ───────────────────────────────────────────────────────────────── */

function pushSys(state, name, what, detail = '') {
  const msg = {
    id: 'sys-' + Math.random().toString(36).slice(2, 9),
    kind: 'system',
    from: '',
    name: String(name || ''),
    text: what,
    extra: detail,
    ts: Date.now(),
    reacts: {},
  };
  return cap([...state.chat, msg]);
}

function cap(chat) {
  return chat.length > LIMITS.chatHistory ? chat.slice(chat.length - LIMITS.chatHistory) : chat;
}

export function pushChat(state, { id, from, name, text, ts }) {
  const clean = String(text || '').slice(0, LIMITS.msgMax);
  if (!clean.trim()) return state;
  const key = String(id || '');
  if (key && state.chat.some((m) => m.id === key)) return state;   // эхо от релея
  const msg = {
    id: key || 'm-' + Math.random().toString(36).slice(2, 10),
    kind: 'user',
    from: String(from || ''),
    name: String(name || 'Гость'),
    text: clean,
    ts: Number(ts) || Date.now(),
    reacts: {},
  };
  return { ...state, chat: cap([...state.chat, msg]) };
}

export function toggleReaction(state, msgId, emoji, av) {
  const e = String(emoji || '');
  if (!e) return state;
  let changed = false;
  const chat = state.chat.map((m) => {
    if (m.id !== msgId) return m;
    const list = (m.reacts && m.reacts[e]) || [];
    const has = list.includes(av);
    const next = has ? list.filter((x) => x !== av) : list.concat(av);
    const reacts = { ...(m.reacts || {}) };
    if (next.length) reacts[e] = next;
    else delete reacts[e];
    changed = true;
    return { ...m, reacts };
  });
  return changed ? { ...state, chat } : state;
}

/* ── события ───────────────────────────────────────────────────────────── */

/**
 * Главный обработчик. Принимает события вида { type, ... } и возвращает новое
 * состояние (или то же самое, если ничего не поменялось).
 */
export function roomReduce(state, evt) {
  switch (evt && evt.type) {
    case 'hello':
      return upsertPeer(state, evt);

    case 'bye': {
      const av = String(evt.av || '');
      const peer = state.peers[av];
      if (!peer) return state;
      const peers = { ...state.peers };
      delete peers[av];
      return {
        ...state,
        peers,
        order: state.order.filter((x) => x !== av),
        chat: pushSys(state, peer.name, 'вышел'),
      };
    }

    case 'media': {
      const av = String(evt.av || '');
      const peer = state.peers[av];
      if (!peer) return state;
      return {
        ...state,
        peers: {
          ...state.peers,
          [av]: {
            ...peer,
            seen: Date.now(),
            mic: evt.mic !== undefined ? !!evt.mic : peer.mic,
            cam: evt.cam !== undefined ? !!evt.cam : peer.cam,
            screen: evt.screen !== undefined ? !!evt.screen : peer.screen,
            hand: evt.hand !== undefined ? !!evt.hand : peer.hand,
            inCall: evt.inCall !== undefined ? !!evt.inCall : peer.inCall,
          },
        },
      };
    }

    case 'chat':
      return pushChat(state, evt);

    case 'react': {
      const withSys = state.chat.some((m) => m.id === evt.id) ? state : pushSys(state, evt.name || 'Гость', 'поставил реакцию', evt.emoji || '');
      return toggleReaction(withSys, String(evt.id || ''), evt.emoji, String(evt.av || ''));
    }

    case 'board':
      if (state.board) state.board.apply(evt.op);
      return state;

    case 'system':
      return { ...state, chat: pushSys(state, evt.name || '', evt.text || '', evt.extra || '') };

    case 'nick': {
      const av = String(evt.av || '');
      const peer = state.peers[av];
      if (!peer) return state;
      return {
        ...state,
        peers: { ...state.peers, [av]: { ...peer, name: String(evt.name || peer.name), seen: Date.now() } },
      };
    }

    case 'prune': {
      const now = Number(evt.now) || Date.now();
      const gone = state.order.filter((av) => now - ((state.peers[av] && state.peers[av].seen) || 0) > PEER_TIMEOUT);
      if (!gone.length) return state;
      let next = state;
      gone.forEach((av) => {
        const peer = next.peers[av];
        const peers = { ...next.peers };
        delete peers[av];
        next = {
          ...next,
          peers,
          order: next.order.filter((x) => x !== av),
          chat: pushSys(next, (peer && peer.name) || 'Участник', 'пропал без прощания'),
        };
      });
      return next;
    }

    default:
      return state;
  }
}

/** Сколько людей сейчас реально на связи (для подписи в колонке каналов). */
export function countState(state) {
  const online = peerList(state).filter((p) => Date.now() - p.seen < PEER_TIMEOUT).length;
  return { total: online + 1, online, inCall: inCall(state).length + 1 };
}
