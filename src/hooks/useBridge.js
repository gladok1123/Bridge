'use client';

/**
 * useBridge — весь рантайм приложения: комната, релей знакомства, сетка
 * прямых соединений, камера и микрофон, чат, доска, запись и проверка связи.
 *
 * Разделение простое: логика комнаты живёт в core/room.js, сеть — в core/rtc.js
 * и lib/relay.js, а здесь они соединяются и превращаются в состояние React.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DEFAULT_SETTINGS, parseIceServers } from '@/lib/util.js';
import { ENV } from '@/lib/config.js';
import { RelayLink } from '@/lib/relay.js';
import { randomSecret, topicFor, fingerprint } from '@/lib/crypto.js';
import { Mesh } from '@/core/rtc.js';
import { BoardStore, strokeId } from '@/core/board.js';
import {
  attachMeter, detachMeter, requestMedia, requestScreen, stopStream, resumeAudio, isSecure,
} from '@/core/media.js';
import { Recorder, recordingName } from '@/core/recorder.js';
import { blip, setSoundMuted } from '@/core/ringtone.js';
import { localChecks, networkChecks, worst } from '@/core/diag.js';
import { createRoomState, roomReduce, peerList, countState, pushChat } from '@/core/room.js';
import {
  normalizeRoom, roomFromInput, makeRoomCode, shortId, defaultName, fmtDuration,
} from '@/lib/util.js';

const HISTORY_KEY = 'bridge.rooms.v1';
const HELLO_EVERY = 12000;      // редкий пульс: чаще не нужно, канал связи уже прямой
const PRUNE_EVERY = 5000;
const SPEAK_LEVEL = 0.09;
const MAX_HISTORY = 12;

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** Настройки отправки из интерфейса в вид, понятный сетке. */
function tuningFromSettings(s) {
  return {
    cam: {
      quality: Number(s.camQuality) || 720,
      fps: Number(s.camFps) || 30,
      bitrate: Number(s.camBitrate) || 0,
      hint: 'auto',
    },
    screen: {
      quality: Number(s.screenQuality) || 1080,
      fps: Number(s.screenFps) || 30,
      bitrate: Number(s.screenBitrate) || 0,
      hint: s.streamHint || 'auto',
    },
  };
}

function splitStream(stream) {
  const mic = stream.getAudioTracks().length ? new MediaStream(stream.getAudioTracks()) : null;
  const cam = stream.getVideoTracks().length ? new MediaStream(stream.getVideoTracks()) : null;
  return { mic, cam };
}

export function useBridge() {
  /* ── настройки ───────────────────────────────────────────────────────── */
  const [settings, setSettings] = useState(() => ({ ...DEFAULT_SETTINGS, ...(typeof localStorage !== 'undefined' ? JSON.parse(localStorage.getItem('bridge.settings.v1') || '{}') : {}) }));
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const update = useCallback((patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem('bridge.settings.v1', JSON.stringify(next));
      } catch {
        /* приватный режим */
      }
      settingsRef.current = next;
      return next;
    });
  }, []);

  /* ── состояние ───────────────────────────────────────────────────────── */
  const [phase, setPhase] = useState('home');
  const [room, setRoom] = useState({ code: '', secret: '', topic: '', fp: '' });
  const [state, setState] = useState(createRoomState);
  const [boardRev, setBoardRev] = useState(0);
  const [trackRev, setTrackRev] = useState(0);
  const [linkRev, setLinkRev] = useState(0);
  const [media, setMedia] = useState({ mic: false, cam: false, screen: false, hand: false, mode: 'idle', busy: false, error: '' });
  const [relayStatus, setRelayStatus] = useState({ mode: 'idle', ok: false, base: '', error: '', sent: 0, got: 0 });
  const [stats, setStats] = useState([]);
  const [levels, setLevels] = useState({});
  const [toasts, setToasts] = useState([]);
  const [recording, setRecording] = useState({ active: false, ms: 0, bytes: 0, error: '' });
  const [diag, setDiag] = useState({ running: false, rows: [], at: 0 });
  const [history, setHistory] = useState(() => {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(HISTORY_KEY) : null;
      const v = raw ? JSON.parse(raw) : [];
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  });

  /* ── ссылки на живое ─────────────────────────────────────────────────── */
  const relayRef = useRef(null);
  const meshRef = useRef(null);
  const boardRef = useRef(new BoardStore());
  const meRef = useRef({ av: '', name: '' });
  const mediaRef = useRef({ mic: null, cam: null, screen: null, micRead: null, hand: false, levels: {} });
  const seenRef = useRef(new Set());
  const recRef = useRef(null);
  const timersRef = useRef({ hello: 0, prune: 0, levels: 0 });
  const boardRevAtRef = useRef(0);
  const lastRelayBoardRef = useRef(0);
  const strokeSeqRef = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  const say = useCallback((title, text = '', tone = 'info', ms = 5200) => {
    const id = uid();
    setToasts((prev) => [...prev.slice(-4), { id, title, text, tone }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), ms);
  }, []);

  const dropToast = useCallback((id) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

  const bumpBoard = useCallback((force = false) => {
    const now = Date.now();
    if (!force && now - boardRevAtRef.current < 90) return;
    boardRevAtRef.current = now;
    setBoardRev((v) => v + 1);
  }, []);

  /* ── история комнат ──────────────────────────────────────────────────── */
  const remember = useCallback((entry) => {
    setHistory((prev) => {
      const next = [{ ...entry, at: Date.now() }, ...prev.filter((r) => r.code !== entry.code)].slice(0, MAX_HISTORY);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        /* приватный режим */
      }
      return next;
    });
  }, []);

  const forget = useCallback((code) => {
    setHistory((prev) => {
      const next = prev.filter((r) => r.code !== code);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        /* ничего */
      }
      return next;
    });
  }, []);

  /* ── отправка ────────────────────────────────────────────────────────── */

  /** Разослать сообщение: прямыми каналами, а кому не дошло — через релей. */
  const send = useCallback((msg, { force = false } = {}) => {
    const full = { id: msg.id || uid(), from: meRef.current.av, name: meRef.current.name, ts: Date.now(), ...msg };
    const mesh = meshRef.current;
    const reached = mesh ? mesh.broadcast(full) : [];
    const peerCount = mesh ? mesh.peers.size : 0;
    const mustRelay = force || reached.length < peerCount || peerCount === 0;
    if (mustRelay && relayRef.current) {
      if (full.kind === 'board') {
        const now = Date.now();
        if (now - lastRelayBoardRef.current < 140) return full;
        lastRelayBoardRef.current = now;
      }
      relayRef.current.send({ t: 'data', ...full });
    }
    return full;
  }, []);

  const sendTo = useCallback((av, msg) => {
    const mesh = meshRef.current;
    const full = { id: msg.id || uid(), from: meRef.current.av, name: meRef.current.name, ts: Date.now(), ...msg };
    const p = mesh && mesh.peers.get(av);
    if (p && p.dcOpen) mesh.sendRaw(p, full);
    return full;
  }, []);

  /* ── приём ───────────────────────────────────────────────────────────── */

  const handleData = useCallback((data) => {
    if (!data || typeof data !== 'object') return;
    const from = String(data.from || '');
    if (!from || from === meRef.current.av) return;
    const id = String(data.id || '');
    if (id) {
      if (seenRef.current.has(id)) return;
      seenRef.current.add(id);
      if (seenRef.current.size > 900) seenRef.current = new Set(Array.from(seenRef.current).slice(-400));
    }
    switch (data.kind) {
      case 'chat':
        setState((prev) => roomReduce(prev, { type: 'chat', id, from, name: data.name, text: data.body, ts: data.ts }));
        blip('message');
        break;
      case 'react':
        setState((prev) => roomReduce(prev, {
          type: 'react',
          id: (data.body && data.body.msgId) || '',
          emoji: (data.body && data.body.emoji) || '',
          av: from,
          name: data.name,
        }));
        break;
      case 'hand':
        setState((prev) => roomReduce(prev, { type: 'media', av: from, hand: !!data.body }));
        if (data.body) blip('hand');
        break;
      case 'media':
        setState((prev) => roomReduce(prev, { type: 'media', av: from, ...(data.body || {}) }));
        break;
      case 'nick':
        setState((prev) => roomReduce(prev, { type: 'nick', av: from, name: data.body }));
        break;
      case 'board':
        if (boardRef.current.apply(data.body)) bumpBoard();
        break;
      case 'snap':
        if (data.body && boardRef.current.apply(data.body)) bumpBoard(true);
        break;
      case 'history':
        setState((prev) => {
          let next = prev;
          (data.body || []).forEach((m) => {
            next = pushChat(next, { id: m.id, from: m.from, name: m.name, text: m.text, ts: m.ts });
          });
          return next;
        });
        break;
      default:
        break;
    }
  }, [bumpBoard]);

  const dataHandlerRef = useRef(handleData);
  dataHandlerRef.current = handleData;

  /* ── сетка соединений ────────────────────────────────────────────────── */

  const ensureMesh = useCallback(() => {
    if (meshRef.current) return meshRef.current;
    const s = settingsRef.current;
    const mesh = new Mesh({
      iceServers: parseIceServers({ stun: s.stun || ENV.stun, turn: s.turn || ENV.turn }),
      selfAv: meRef.current.av,
      onLog: (text, kind) => {
        if (kind === 'bad' || kind === 'warn') say(kind === 'bad' ? 'Связь' : 'Замечание', text, kind === 'bad' ? 'bad' : 'warn');
      },
      onSignal: (av, frame) => {
        if (relayRef.current) relayRef.current.send({ t: 'sig', from: meRef.current.av, to: av, kind: frame.t, payload: frame });
      },
      onPeer: (av, patch) => {
        setLinkRev((v) => v + 1);
        if (patch.dc === true) {
          /* новому напарнику — доска и последние сообщения */
          sendTo(av, { kind: 'snap', body: boardRef.current.snapshot() });
          const chat = stateRef.current.chat.filter((m) => m.kind === 'user').slice(-40);
          if (chat.length) sendTo(av, { kind: 'history', body: chat });
          say('Прямой канал открыт', 'Собеседник подключён напрямую, без сервера', 'ok', 3200);
        }
      },
      onTrack: () => setTrackRev((v) => v + 1),
      onData: (_av, obj) => dataHandlerRef.current(obj),
      onLevel: (av, level) => {
        mediaRef.current.levels = mediaRef.current.levels || {};
        mediaRef.current.levels[av] = level;
      },
      onStats: (list) => setStats(list),
    });
    mesh.ensureMeterLoop();
    meshRef.current = mesh;
    return mesh;
  }, [say, sendTo]);

  /* ── присутствие и служебные кадры ───────────────────────────────────── */

  const helloPayload = useCallback(() => {
    const m = mediaRef.current;
    return {
      t: 'hello',
      from: meRef.current.av,
      name: meRef.current.name,
      mic: !!m.mic,
      cam: !!m.cam,
      screen: !!m.screen,
      hand: !!m.hand,
      ts: Date.now(),
    };
  }, []);

  const handleFrame = useCallback((data) => {
    if (!data || typeof data !== 'object') return;
    const from = String(data.from || '');
    if (!from || from === meRef.current.av) return;

    if (data.t === 'hello') {
      if (data.ts && Date.now() - data.ts > 60000) return;    // кадр из кэша релея — не живой
      const known = stateRef.current.peers[from];
      setState((prev) => roomReduce(prev, {
        type: 'hello', av: from, name: data.name, mic: data.mic, cam: data.cam, screen: data.screen, hand: data.hand,
      }));
      if (!known) {
        blip('join');
        say('В комнате появился человек', String(data.name || 'Гость'), 'ok', 3600);
        const mesh = ensureMesh();
        mesh.addPeer(from, data.name || '');
        if (relayRef.current) relayRef.current.send(helloPayload());   // отвечаем, чтобы нас тоже увидели
      } else if (meshRef.current && !meshRef.current.peers.has(from)) {
        meshRef.current.addPeer(from, data.name || '');
      }
      return;
    }

    if (data.t === 'bye') {
      setState((prev) => roomReduce(prev, { type: 'bye', av: from }));
      if (meshRef.current) meshRef.current.removePeer(from, 'вышел');
      blip('leave');
      return;
    }

    if (data.t === 'sig') {
      const mesh = ensureMesh();
      mesh.onRemote(from, data.payload || { t: data.kind });
      return;
    }

    if (data.t === 'data') handleData(data);
  }, [ensureMesh, handleData, helloPayload, say]);

  const frameHandlerRef = useRef(handleFrame);
  frameHandlerRef.current = handleFrame;

  /* ── вход и выход ────────────────────────────────────────────────────── */

  const join = useCallback(async (input, opts = {}) => {
    resumeAudio();
    const code = normalizeRoom(roomFromInput(input) || input || '', 'общий');
    const secret = opts.secret
      || (typeof window !== 'undefined' && window.location.hash.includes('k=')
        ? new URLSearchParams(window.location.hash.slice(1)).get('k') || ''
        : '')
      || randomSecret();
    const name = (settingsRef.current.name || '').trim() || defaultName();
    const av = settingsRef.current.av || shortId(5);
    if (!settingsRef.current.av) update({ av });
    meRef.current = { av, name };

    const fp = await fingerprint(secret);
    const topic = await topicFor(code, secret);
    setRoom({ code, secret, topic, fp });

    /* чистая доска на новую комнату */
    boardRef.current = new BoardStore();
    setState({ ...createRoomState(), room: code, me: av, name, board: boardRef.current, joinedAt: Date.now() });
    setBoardRev((v) => v + 1);
    setStats([]);
    setLevels({});
    setPhase('room');

    /* адресная строка: ссылку можно просто скопировать и отправить */
    if (typeof window !== 'undefined') {
      try {
        window.history.replaceState(null, '', '/r/' + encodeURIComponent(code) + '#k=' + secret);
      } catch {
        /* не обязательно */
      }
    }

    /* релей знакомства */
    const relay = new RelayLink({
      onFrame: (d) => frameHandlerRef.current(d),
      onStatus: (st) => setRelayStatus(st),
      onLog: (text, kind) => say('Релей', text, kind === 'bad' ? 'bad' : kind === 'warn' ? 'warn' : 'info'),
    });
    relay.setMe(av);
    relayRef.current = relay;
    await relay.start({ room: code, secret, wsUrl: settingsRef.current.relay || ENV.wsRelay });
    relay.setMe(av);

    /* сетка: сразу с выбранным качеством отправки */
    const mesh = ensureMesh();
    mesh.setSelf(av);
    await mesh.setTuning(tuningFromSettings(settingsRef.current));

    /* медиа */
    setMedia({ mic: false, cam: false, screen: false, hand: false, mode: 'idle', busy: true, error: '' });
    const wantCam = !!settingsRef.current.cam;
    const wantMic = settingsRef.current.mic !== false;
    const res = await requestMedia({
      video: wantCam,
      audio: wantMic,
      quality: Number(settingsRef.current.camQuality || settingsRef.current.videoQuality) || 720,
      fps: Number(settingsRef.current.camFps || settingsRef.current.fps) || 30,
      audioPrefs: {
        noiseSuppress: settingsRef.current.noiseSuppress,
        echoCancel: settingsRef.current.echoCancel,
        autoGain: settingsRef.current.autoGain,
      },
    });
    let mode = 'idle';
    let err = '';
    if (res.stream) {
      const { mic, cam } = splitStream(res.stream);
      if (mic) {
        mediaRef.current.mic = mic;
        mediaRef.current.micRead = attachMeter(mic);
        await mesh.setLocal('mic', mic);
      }
      if (cam) {
        mediaRef.current.cam = cam;
        await mesh.setLocal('cam', cam);
      }
      mode = mic && cam ? 'full' : mic ? 'audio' : cam ? 'video' : 'silent';
      err = res.error || '';
      if (res.error) say('Камера не включилась', res.error, 'warn', 7000);
    } else {
      mode = res.code === 'insecure' || res.code === 'denied' ? 'blocked' : 'nodata';
      err = res.error || '';
      say('Звук и камера недоступны', err, 'bad', 9000);
    }
    setMedia({
      mic: !!mediaRef.current.mic,
      cam: !!mediaRef.current.cam,
      screen: false,
      hand: false,
      mode,
      busy: false,
      error: err,
    });

    /* присутствие */
    relay.send(helloPayload());
    timersRef.current.hello = setInterval(() => {
      const meshNow = meshRef.current;
      const allDirect = meshNow && meshNow.peers.size > 0 && [...meshNow.peers.values()].every((p) => p.dcOpen);
      if (allDirect) return;                        // связь уже прямая: пульс через релей не нужен
      if (relayRef.current) relayRef.current.send(helloPayload());
    }, HELLO_EVERY);
    timersRef.current.prune = setInterval(() => setState((prev) => roomReduce(prev, { type: 'prune', now: Date.now() })), PRUNE_EVERY);
    timersRef.current.levels = setInterval(() => {
      const m = mediaRef.current;
      const next = { ...(m.levels || {}) };
      if (m.micRead) next[meRef.current.av] = m.micRead();
      setLevels(next);
    }, 260);

    remember({ code, secret, name, at: Date.now() });
    say('Вы в комнате «' + code + '»', 'Позвать друзей — кнопка «Позвать» в шапке', 'ok');
    return true;
  }, [ensureMesh, helloPayload, remember, say, update]);

  const leave = useCallback(() => {
    const relay = relayRef.current;
    const mesh = meshRef.current;
    if (relay) {
      try {
        relay.send({ t: 'bye', from: meRef.current.av, name: meRef.current.name });
      } catch {
        /* уже */
      }
    }
    if (mesh) mesh.close();
    if (relay) relay.stop();
    meshRef.current = null;
    relayRef.current = null;
    clearInterval(timersRef.current.hello);
    clearInterval(timersRef.current.prune);
    clearInterval(timersRef.current.levels);
    if (mediaRef.current.mic) detachMeter(mediaRef.current.mic);
    ['mic', 'cam', 'screen'].forEach((k) => {
      stopStream(mediaRef.current[k]);
      mediaRef.current[k] = null;
    });
    mediaRef.current.micRead = null;
    mediaRef.current.levels = {};
    if (recRef.current && recRef.current.active) recRef.current.stop();
    recRef.current = null;
    setMedia({ mic: false, cam: false, screen: false, hand: false, mode: 'idle', busy: false, error: '' });
    setStats([]);
    setLevels({});
    setRecording({ active: false, ms: 0, bytes: 0, error: '' });
    setPhase('home');
    setState(createRoomState());
    seenRef.current = new Set();
  }, []);

  useEffect(() => {
    const onHide = () => {
      if (phase === 'room') {
        try {
          leave();
        } catch {
          /* ничего */
        }
      }
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [phase, leave]);

  /* ── медиа ───────────────────────────────────────────────────────────── */

  const announceMedia = useCallback(() => {
    const m = mediaRef.current;
    send({ kind: 'media', body: { mic: !!m.mic, cam: !!m.cam, screen: !!m.screen, hand: !!m.hand } });
  }, [send]);

  const toggleMic = useCallback(async () => {
    const mesh = meshRef.current;
    const m = mediaRef.current;
    if (m.mic) {
      stopStream(m.mic);
      detachMeter(m.mic);
      m.mic = null;
      m.micRead = null;
      if (mesh) await mesh.setLocal('mic', null);
      update({ mic: false });
      setMedia((prev) => ({ ...prev, mic: false }));
      blip('mute');
      announceMedia();
      return;
    }
    const res = await requestMedia({
      video: false,
      audio: true,
      audioPrefs: {
        noiseSuppress: settingsRef.current.noiseSuppress,
        echoCancel: settingsRef.current.echoCancel,
        autoGain: settingsRef.current.autoGain,
      },
    });
    if (!res.stream || !res.stream.getAudioTracks().length) {
      say('Микрофон не включился', res.error, 'bad', 7000);
      setMedia((prev) => ({ ...prev, error: res.error || '', mode: res.code === 'insecure' ? 'blocked' : prev.mode }));
      return;
    }
    m.mic = new MediaStream(res.stream.getAudioTracks());
    m.micRead = attachMeter(m.mic);
    if (mesh) await mesh.setLocal('mic', m.mic);
    update({ mic: true });
    setMedia((prev) => ({ ...prev, mic: true, error: '', mode: prev.mode === 'blocked' ? 'audio' : prev.mode }));
    announceMedia();
    blip('join');
  }, [announceMedia, say, update]);

  const toggleCam = useCallback(async () => {
    const mesh = meshRef.current;
    const m = mediaRef.current;
    if (m.cam) {
      stopStream(m.cam);
      m.cam = null;
      if (mesh) await mesh.setLocal('cam', null);
      update({ cam: false });
      setMedia((prev) => ({ ...prev, cam: false }));
      announceMedia();
      return;
    }
    const res = await requestMedia({
      video: true,
      audio: false,
      quality: Number(settingsRef.current.camQuality || settingsRef.current.videoQuality) || 720,
      fps: Number(settingsRef.current.camFps || settingsRef.current.fps) || 30,
    });
    if (!res.stream || !res.stream.getVideoTracks().length) {
      say('Камера не включилась', res.error || 'проверьте доступ к камере', 'bad', 7000);
      setMedia((prev) => ({ ...prev, error: res.error || '', mode: res.code === 'insecure' ? 'blocked' : prev.mode }));
      return;
    }
    m.cam = new MediaStream(res.stream.getVideoTracks());
    if (mesh) await mesh.setLocal('cam', m.cam);
    update({ cam: true });
    setMedia((prev) => ({ ...prev, cam: true, error: '', mode: prev.mode === 'blocked' ? 'video' : prev.mode }));
    announceMedia();
    blip('join');
  }, [announceMedia, say, update]);

  const shareScreen = useCallback(async () => {
    const mesh = meshRef.current;
    const m = mediaRef.current;
    if (m.screen) {
      stopStream(m.screen);
      m.screen = null;
      if (mesh) await mesh.setLocal('scr', null);
      setMedia((prev) => ({ ...prev, screen: false }));
      announceMedia();
      say('Показ экрана остановлен', '', 'info', 2800);
      return;
    }
    const res = await requestScreen({
      quality: Number(settingsRef.current.screenQuality) || 1080,
      fps: Number(settingsRef.current.screenFps || settingsRef.current.fps) || 30,
      audio: !!settingsRef.current.shareAudio,
    });
    if (!res.stream) {
      say('Экран не отдался', res.error, res.code === 'unsupported' ? 'warn' : 'bad', 7000);
      return;
    }
    m.screen = res.stream;
    res.stream.getVideoTracks().forEach((t) => {
      t.onended = () => {
        mediaRef.current.screen = null;
        if (meshRef.current) meshRef.current.setLocal('scr', null);
        setMedia((prev) => ({ ...prev, screen: false }));
        announceMedia();
      };
    });
    if (mesh) await mesh.setLocal('scr', res.stream);
    setMedia((prev) => ({ ...prev, screen: true }));
    announceMedia();
    blip('join');
  }, [announceMedia, say]);

  const toggleHand = useCallback(() => {
    const hand = !mediaRef.current.hand;
    mediaRef.current.hand = hand;
    setMedia((prev) => ({ ...prev, hand }));
    if (hand) blip('hand');
    send({ kind: 'hand', body: hand });
  }, [send]);

  /* ── чат, реакции, имя ───────────────────────────────────────────────── */

  const sendChat = useCallback((text) => {
    const clean = String(text || '').trim();
    if (!clean) return;
    const msg = { id: uid(), kind: 'chat', body: clean, ts: Date.now() };
    setState((prev) => roomReduce(prev, {
      type: 'chat', id: msg.id, from: meRef.current.av, name: meRef.current.name, text: clean, ts: msg.ts,
    }));
    send(msg);
  }, [send]);

  const react = useCallback((msgId, emoji) => {
    setState((prev) => roomReduce(prev, { type: 'react', id: msgId, emoji, av: meRef.current.av, name: meRef.current.name }));
    send({ kind: 'react', body: { msgId, emoji } });
  }, [send]);

  const rename = useCallback((name) => {
    const clean = String(name || '').trim().slice(0, 40);
    if (!clean) return;
    meRef.current = { ...meRef.current, name: clean };
    update({ name: clean });
    setState((prev) => ({ ...prev, name: clean }));
    send({ kind: 'nick', body: clean });
    if (relayRef.current) relayRef.current.send(helloPayload());
  }, [helloPayload, send, update]);

  /* ── доска ───────────────────────────────────────────────────────────── */

  const board = useMemo(() => ({
    start(x, y, color, w) {
      const sid = strokeId(meRef.current.av, ++strokeSeqRef.current);
      const op = { t: 'pt', sid, color, w, a: meRef.current.av, pts: [[x, y]] };
      boardRef.current.apply(op);
      bumpBoard(true);
      send({ kind: 'board', body: op });
      return sid;
    },
    move(sid, pts, color, w) {
      if (!pts || !pts.length) return;
      const op = { t: 'pt', sid, color, w, a: meRef.current.av, pts };
      boardRef.current.apply(op);
      bumpBoard();
      send({ kind: 'board', body: op });
    },
    end(sid) {
      const op = { t: 'end', sid };
      boardRef.current.apply(op);
      send({ kind: 'board', body: op });
    },
    undo() {
      boardRef.current.apply({ t: 'undo' });
      bumpBoard(true);
      send({ kind: 'board', body: { t: 'undo' } });
    },
    clear() {
      boardRef.current.apply({ t: 'clear' });
      bumpBoard(true);
      send({ kind: 'board', body: { t: 'clear' } });
    },
    get store() {
      return boardRef.current;
    },
  }), [bumpBoard, send]);

  /* ── запись ──────────────────────────────────────────────────────────── */

  const startRecording = useCallback(async ({ tiles } = {}) => {
    if (recRef.current && recRef.current.active) return;
    const audioStreams = [];
    const mesh = meshRef.current;
    if (mesh) mesh.peers.forEach((p) => { if (p.remote.audio) audioStreams.push(p.remote.audio); });
    const rec = new Recorder({
      onTick: (ms, bytes) => setRecording({ active: true, ms, bytes, error: '' }),
      onDone: (blob, mime) => {
        const ext = mime.includes('mp4') ? 'mp4' : 'webm';
        const fileName = recordingName(room.code, ext);
        try {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = fileName;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 4000);
          say('Запись готова', 'Файл в загрузках: ' + fileName, 'ok', 8000);
        } catch (e) {
          say('Не смог сохранить запись', String(e.message || e), 'bad');
        }
        setRecording({ active: false, ms: 0, bytes: 0, error: '' });
      },
      onLog: (text, kind) => say('Запись', text, kind),
    });
    const res = await rec.start({
      tiles: tiles || [],
      audioStreams,
      audio: mediaRef.current.mic,
      fps: Number(settingsRef.current.fps) || 30,
      me: meRef.current,
    });
    if (!res.ok) {
      say('Запись не пошла', res.error, 'bad', 7000);
      setRecording({ active: false, ms: 0, bytes: 0, error: res.error });
      return;
    }
    recRef.current = rec;
    setRecording({ active: true, ms: 0, bytes: 0, error: '' });
    blip('recStart');
  }, [room.code, say]);

  const stopRecording = useCallback(() => {
    if (recRef.current) {
      recRef.current.stop();
      recRef.current = null;
      blip('recStop');
    }
  }, []);

  /* ── проверка связи ──────────────────────────────────────────────────── */

  const runDiag = useCallback(async () => {
    setDiag((prev) => ({ ...prev, running: true }));
    const rows = [];
    const local = await localChecks();
    rows.push(...local);
    setDiag({ running: true, rows: rows.slice(), at: Date.now() });
    const s = settingsRef.current;
    const net = await networkChecks({
      relay: relayRef.current,
      room: room.code,
      secret: room.secret,
      iceServers: parseIceServers({ stun: s.stun || ENV.stun, turn: s.turn || ENV.turn }),
      onRow: (_r, all) => setDiag({ running: true, rows: [...rows, ...all], at: Date.now() }),
    });
    setDiag({ running: false, rows: [...rows, ...net], at: Date.now() });
  }, [room.code, room.secret]);

  /* ── наружу ──────────────────────────────────────────────────────────── */

  const peers = useMemo(() => peerList(state), [state]);
  const counts = useMemo(() => countState(state), [state, linkRev]);

  const me = useMemo(() => ({
    av: state.me,
    name: state.name,
    level: levels[state.me] || 0,
    speaking: (levels[state.me] || 0) > SPEAK_LEVEL,
  }), [levels, state.me, state.name]);

  const speaking = useMemo(() => {
    const out = {};
    Object.keys(levels).forEach((av) => { out[av] = levels[av] > SPEAK_LEVEL; });
    return out;
  }, [levels]);

  /** Ссылки: состояние прямого канала и замеры — по участнику. */
  const links = useMemo(() => {
    const mesh = meshRef.current;
    const out = {};
    if (mesh) {
      mesh.peers.forEach((p, av) => {
        out[av] = {
          connection: p.pc.connectionState,
          ice: p.pc.iceConnectionState,
          dcOpen: p.dcOpen,
          connected: p.connected,
        };
      });
    }
    (stats || []).forEach((s) => {
      out[s.av] = { ...(out[s.av] || {}), ...s };
    });
    return out;
  }, [stats, linkRev]);

  /** Свои потоки: нужны сцене (превью) и записи. */
  const localStreams = useMemo(() => ({
    mic: mediaRef.current.mic,
    cam: mediaRef.current.cam,
    screen: mediaRef.current.screen,
  }), [media.mic, media.cam, media.screen, trackRev]);

  /** Живые потоки участника — для <video> и <audio>. */
  const remoteStream = useCallback((av, kind = 'video') => {
    const mesh = meshRef.current;
    const p = mesh && mesh.peers.get(av);
    if (!p) return null;
    return kind === 'audio' ? p.remote.audio : p.remote.video;
  }, []);

  const inviteUrl = useMemo(() => {
    if (typeof window === 'undefined' || !room.code) return '';
    return window.location.origin + '/r/' + encodeURIComponent(room.code) + '#k=' + room.secret;
  }, [room.code, room.secret]);

  const copyInvite = useCallback(async () => {
    const text = 'Заходи в Bridge — звонок «' + room.code + '»:  ' + inviteUrl;
    try {
      await navigator.clipboard.writeText(text);
      say('Ссылка скопирована', 'Отправьте её друзьям — по ней они попадут прямо в эту комнату', 'ok');
    } catch {
      say('Скопируйте ссылку вручную', inviteUrl, 'warn', 9000);
    }
  }, [inviteUrl, room.code, say]);

  const setSound = useCallback((muted) => {
    setSoundMuted(muted);
    say(muted ? 'Звуки выключены' : 'Звуки включены', '', 'info', 2200);
  }, [say]);

  /* меняете качество в настройках или на плашке показа экрана — применяется сразу */
  const tuningKey = [settings.camQuality, settings.camFps, settings.camBitrate,
    settings.screenQuality, settings.screenFps, settings.screenBitrate, settings.streamHint].join('|');
  useEffect(() => {
    if (!meshRef.current || !meRef.current.av) return;
    meshRef.current.setTuning(tuningFromSettings(settingsRef.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tuningKey]);

  useEffect(() => () => {
    clearInterval(timersRef.current.hello);
    clearInterval(timersRef.current.prune);
    clearInterval(timersRef.current.levels);
    if (relayRef.current) relayRef.current.stop();
    if (meshRef.current) meshRef.current.close();
  }, []);

  /** Что сейчас применяется к потокам — показываем в интерфейсе. */
  const tuning = useMemo(() => tuningFromSettings(settings), [
    settings.camQuality, settings.camFps, settings.camBitrate,
    settings.screenQuality, settings.screenFps, settings.screenBitrate, settings.streamHint,
  ]);

  /** Быстрая смена качества (используется на плашке показа экрана). */
  const setScreenTuning = useCallback((patch) => update(patch), [update]);

  return {
    settings, update, tuning, setScreenTuning,
    phase, room, me, state, counts, peers,
    history, remember, forget,
    inviteUrl, copyInvite,
    media, levels, speaking, relayStatus, stats, links,
    diag, diagTone: worst(diag.rows), runDiag,
    board, boardRev, trackRev, recording, startRecording, stopRecording,
    join, leave, toggleMic, toggleCam, shareScreen, toggleHand, sendChat, react, rename, setSound,
    toasts, say, dropToast, remoteStream, localStreams, secure: isSecure(),
    newRoom: makeRoomCode, fmtDuration, trackRev,
  };
}
