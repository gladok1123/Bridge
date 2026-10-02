/**
 * Поддельный браузер для проверки Bridge без настоящего окна.
 *
 * Здесь только то, чем пользуется приложение: медиаустройства, WebRTC,
 * звук, запись, холст, сеть релея. Всё остальное делает jsdom.
 */
import { webcrypto } from 'node:crypto';

export function installMocks(win, { secure = true, denyMedia = false, ua = '' } = {}) {
  const state = {
    streams: [],
    peers: [],          // поддельные RTCPeerConnection
    published: [],      // что ушло на релей
    sseFrames: [],
    sseQueues: [],
    anchors: 0,
    errors: [],
    denied: denyMedia,
  };

  /* crypto у jsdom — только генератор случайных чисел; добавляем весь WebCrypto */
  try {
    Object.defineProperty(win, 'crypto', { value: webcrypto, configurable: true, writable: true });
  } catch {
    Object.defineProperty(win.crypto, 'subtle', { value: webcrypto.subtle, configurable: true });
  }
  win.TextEncoder = TextEncoder;
  win.TextDecoder = TextDecoder;
  win.isSecureContext = secure;
  Object.defineProperty(win, 'navigator', { value: win.navigator || {}, configurable: true, writable: true });
  if (ua) Object.defineProperty(win.navigator, 'userAgent', { value: ua, configurable: true });

  win.addEventListener('error', (e) => {
    const err = e.error || {};
    state.errors.push('error: ' + (e.message || err.message) + (err.stack ? '\n      ' + String(err.stack).split('\n').slice(0, 4).join('\n      ') : ''));
  });
  win.addEventListener('unhandledrejection', (e) => {
    const r = e.reason || {};
    state.errors.push('rejection: ' + (r.message || r) + (r.stack ? '\n      ' + String(r.stack).split('\n').slice(0, 4).join('\n      ') : ''));
  });

  /* ── медиаустройства ─────────────────────────────────────────────────── */
  class FakeTrack {
    constructor(kind, size = {}) {
      this.kind = kind;
      this.readyState = 'live';
      this.enabled = true;
      this.id = kind + '-' + Math.random().toString(36).slice(2, 8);
      this.onended = null;
      this.contentHint = '';
      this.constraints = [];
      this.size = { width: size.width || (kind === 'video' ? 1280 : 0), height: size.height || (kind === 'video' ? 720 : 0) };
    }
    getSettings() {
      return { width: this.size.width, height: this.size.height, frameRate: 30, deviceId: 'fake' };
    }
    async applyConstraints(c) {
      this.constraints.push(c);
      if (c && c.width && c.width.ideal) this.size.width = c.width.ideal;
      if (c && c.height && c.height.ideal) this.size.height = c.height.ideal;
      return true;
    }
    stop() {
      this.readyState = 'ended';
      if (this.onended) this.onended();
    }
  }

  class FakeStream {
    constructor(tracks = []) {
      this.id = 'stream-' + Math.random().toString(36).slice(2, 9);
      this.tracks = [...tracks];
    }
    getTracks() { return [...this.tracks]; }
    getAudioTracks() { return this.tracks.filter((t) => t.kind === 'audio'); }
    getVideoTracks() { return this.tracks.filter((t) => t.kind === 'video'); }
    addTrack(t) { if (!this.tracks.includes(t)) this.tracks.push(t); }
    removeTrack(t) { this.tracks = this.tracks.filter((x) => x !== t); }
  }
  win.MediaStream = FakeStream;

  const makeStream = (opts = {}) => {
    const tracks = [];
    if (opts.audio !== false) tracks.push(new FakeTrack('audio'));
    if (opts.video) tracks.push(new FakeTrack('video', { width: opts.width, height: opts.height }));
    const s = new FakeStream(tracks);
    s.videoTrack = tracks.find((t) => t.kind === 'video') || null;
    state.streams.push(s);
    return s;
  };

  const mediaDevices = {
    async enumerateDevices() {
      return [
        { kind: 'videoinput', deviceId: 'cam1', label: 'Камера' },
        { kind: 'audioinput', deviceId: 'mic1', label: 'Микрофон' },
        { kind: 'audiooutput', deviceId: 'spk1', label: 'Динамики' },
      ];
    },
    async getUserMedia(constraints = {}) {
      if (state.denied || !secure) {
        const e = new Error('нет доступа');
        e.name = state.denied ? 'NotAllowedError' : 'SecurityError';
        throw e;
      }
      if (constraints.video && constraints.audio) return makeStream({ audio: true, video: true });
      if (constraints.video) return makeStream({ audio: false, video: true });
      return makeStream({ audio: true });
    },
    async getDisplayMedia(constraints = {}) {
      if (!secure || state.denied) {
        const e = new Error('нет доступа');
        e.name = 'NotAllowedError';
        throw e;
      }
      /* как настоящий браузер: отдаём экран 4K, если разрешили, и не больше */
      const want = (constraints.video && constraints.video.width && constraints.video.width.max) || 3840;
      const wantH = (constraints.video && constraints.video.height && constraints.video.height.max) || 2160;
      const tracks = [new FakeTrack('video', { width: Math.min(3840, want), height: Math.min(2160, wantH) })];
      const s = new FakeStream(tracks);
      s.videoTrack = tracks[0];
      s.requested = constraints;
      state.lastDisplay = s;
      state.displayRequests = state.displayRequests || [];
      state.displayRequests.push(constraints);
      state.streams.push(s);
      return s;
    },
  };
  Object.defineProperty(win.navigator, 'mediaDevices', { value: mediaDevices, configurable: true });

  /* ── WebRTC ──────────────────────────────────────────────────────────── */
  class FakeDC {
    constructor(label) {
      this.label = label;
      this.readyState = 'connecting';
      this.onopen = null;
      this.onclose = null;
      this.onmessage = null;
      this.sent = [];
    }
    send(text) { this.sent.push(text); }
    close() { this.readyState = 'closed'; if (this.onclose) this.onclose(); }
    open() { this.readyState = 'open'; if (this.onopen) this.onopen(); }
    deliver(obj) { if (this.onmessage) this.onmessage({ data: typeof obj === 'string' ? obj : JSON.stringify(obj) }); }
  }

  class FakeSender {
    constructor(pc, kind) {
      this.pc = pc;
      this.kind = kind;
      this.track = null;
      this.params = null;
      this.history = [];
    }
    async replaceTrack(t) { this.track = t; return true; }
    async setParameters(p) {
      /* запоминаем копию: проверяем, что реально применилось */
      this.params = JSON.parse(JSON.stringify(p));
      this.history.push(this.params);
      return true;
    }
    getParameters() {
      return this.params ? JSON.parse(JSON.stringify(this.params)) : { encodings: [{}] };
    }
  }

  class FakePC {
    constructor(config = {}) {
      this.config = config;
      this.connectionState = 'new';
      this.iceConnectionState = 'new';
      this.signalingState = 'stable';
      this.localDescription = null;
      this.remoteDescription = null;
      this.transceivers = [];
      this.channels = [];
      this.sentCandidates = 0;
      this.onnegotiationneeded = null;
      this.onicecandidate = null;
      this.onconnectionstatechange = null;
      this.oniceconnectionstatechange = null;
      this.ontrack = null;
      this.ondatachannel = null;
      state.peers.push(this);
    }
    addTransceiver(kind) {
      const t = { kind, sender: new FakeSender(this, kind), mid: String(this.transceivers.length), direction: 'sendrecv', currentDirection: 'sendrecv' };
      this.transceivers.push(t);
      /* как настоящий браузер: после добавления дорожек нужно переговариваться */
      setTimeout(() => {
        if (this.onnegotiationneeded && this.signalingState === 'stable') this.onnegotiationneeded();
      }, 15);
      return t;
    }
    addTrack(track, stream) {
      const t = this.addTransceiver(track.kind);
      t.sender.track = track;
      t.streams = [stream];
      return t.sender;
    }
    getSenders() { return this.transceivers.map((t) => t.sender); }
    createDataChannel(label) {
      const dc = new FakeDC(label);
      this.channels.push(dc);
      return dc;
    }
    async createOffer() { return { type: 'offer', sdp: 'v=0\r\no=- fake offer' }; }
    async createAnswer() { return { type: 'answer', sdp: 'v=0\r\no=- fake answer' }; }
    async setLocalDescription(desc) {
      this.localDescription = desc || (this.signalingState === 'have-remote-offer'
        ? await this.createAnswer()
        : await this.createOffer());
      this.signalingState = this.localDescription.type === 'offer' ? 'have-local-offer' : 'stable';
      /* пара кандидатов и конец сбора — как в жизни */
      setTimeout(() => {
        if (!this.onicecandidate) return;
        this.onicecandidate({ candidate: { toJSON: () => ({ candidate: 'candidate:1 1 udp 1 192.168.1.5 5000 typ host', type: 'host', address: '192.168.1.5' }) } });
        this.onicecandidate({ candidate: { toJSON: () => ({ candidate: 'candidate:2 1 udp 1 1.2.3.4 5000 typ srflx', type: 'srflx', address: '1.2.3.4' }) } });
        this.onicecandidate({ candidate: null });
      }, 5);
      return this.localDescription;
    }
    async setRemoteDescription(desc) {
      this.remoteDescription = desc;
      this.signalingState = desc.type === 'offer' ? 'have-remote-offer' : 'stable';
      /* отвечающая сторона получает канал */
      if (desc.type === 'offer' && this.ondatachannel && !this.channels.length) {
        const dc = new FakeDC('bridge');
        this.channels.push(dc);
        this.ondatachannel({ channel: dc });
      }
      return true;
    }
    async addIceCandidate() { return true; }
    async getStats() {
      const map = new Map();
      map.set('pair', { type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: 0.043 });
      map.set('in', { type: 'inbound-rtp', kind: 'audio', bytesReceived: 1024 * (Date.now() % 97), jitter: 0.002, packetsLost: 0 });
      map.set('out', { type: 'outbound-rtp', kind: 'audio', bytesSent: 2048 * (Date.now() % 89) });
      map.set('lc', { type: 'local-candidate', candidateType: 'srflx' });
      return map;
    }
    restartIce() { return true; }
    close() { this.connectionState = 'closed'; }
    /* ── помощники для проверки ── */
    connect() {
      this.connectionState = 'connected';
      this.iceConnectionState = 'connected';
      if (this.onconnectionstatechange) this.onconnectionstatechange();
      if (this.oniceconnectionstatechange) this.oniceconnectionstatechange();
    }
    deliverAudio() {
      const stream = new FakeStream([new FakeTrack('audio')]);
      state.streams.push(stream);
      if (this.ontrack) this.ontrack({ track: stream.getAudioTracks()[0], streams: [stream] });
      return stream;
    }
    deliverVideo() {
      const stream = new FakeStream([new FakeTrack('video')]);
      state.streams.push(stream);
      if (this.ontrack) this.ontrack({ track: stream.getVideoTracks()[0], streams: [stream] });
      return stream;
    }
  }
  win.RTCPeerConnection = FakePC;
  win.RTCSessionDescription = function (d) { return d; };

  /* ── звук ────────────────────────────────────────────────────────────── */
  class FakeNode {
    connect() { return this; }
    disconnect() { return this; }
  }
  class FakeAnalyser extends FakeNode {
    constructor() {
      super();
      this.fftSize = 1024;
      this.smoothingTimeConstant = 0.7;
      this.buf = null;
    }
    getFloatTimeDomainData(buf) {
      /* тихий фон с редкими всплесками: проверяем, что «кто говорит» живой */
      const loud = Math.random() < 0.5 ? 0.35 : 0.01;
      for (let i = 0; i < buf.length; i++) buf[i] = Math.sin(i / 4) * loud;
    }
  }
  class FakeAudioContext {
    constructor() {
      this.state = 'running';
      this.currentTime = 0;
      this.destination = new FakeNode();
      this.sampleRate = 48000;
    }
    createMediaStreamSource() { return new FakeNode(); }
    createAnalyser() { return new FakeAnalyser(); }
    createGain() { return Object.assign(new FakeNode(), { gain: { value: 1 } }); }
    createMediaStreamDestination() { return Object.assign(new FakeNode(), { stream: new FakeStream([new FakeTrack('audio')]) }); }
    createOscillator() {
      return Object.assign(new FakeNode(), {
        type: 'sine',
        frequency: { setValueAtTime() {}, linearRampToValueAtTime() {} },
        start() {},
        stop() {},
      });
    }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  }
  win.AudioContext = FakeAudioContext;

  /* ── запись ──────────────────────────────────────────────────────────── */
  class FakeRecorder {
    static isTypeSupported() { return true; }
    constructor(stream, opts) {
      this.stream = stream;
      this.mimeType = (opts && opts.mimeType) || 'video/webm';
      this.state = 'inactive';
      this.ondataavailable = null;
      this.onstop = null;
      state.recorder = this;
    }
    start() {
      this.state = 'recording';
      setTimeout(() => {
        if (this.ondataavailable) this.ondataavailable({ data: new win.Blob(['видео'], { type: 'video/webm' }) });
      }, 10);
    }
    stop() {
      this.state = 'inactive';
      setTimeout(() => { if (this.onstop) this.onstop(); }, 10);
    }
  }
  win.MediaRecorder = FakeRecorder;

  /* ── холст ───────────────────────────────────────────────────────────── */
  const ctx2d = () => ({
    canvas: { width: 1280, height: 720 },
    clearRect() {}, fillRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {},
    moveTo() {}, lineTo() {}, save() {}, restore() {}, translate() {}, scale() {},
    drawImage() {}, fillText() {}, roundRect() {}, rect() {},
    measureText: () => ({ width: 40 }),
    set strokeStyle(v) {}, set fillStyle(v) {}, set lineWidth(v) {}, set lineCap(v) {}, set lineJoin(v) {}, set font(v) {},
  });
  win.HTMLCanvasElement.prototype.getContext = function () { return ctx2d(); };
  win.HTMLCanvasElement.prototype.captureStream = function () {
    const s = new FakeStream([new FakeTrack('video')]);
    state.streams.push(s);
    return s;
  };
  win.Element.prototype.setPointerCapture = function () {};
  win.Element.prototype.releasePointerCapture = function () {};
  win.Element.prototype.requestFullscreen = function () { return Promise.resolve(); };

  /* ── скачивание записи ───────────────────────────────────────────────── */
  win.URL.createObjectURL = () => 'blob:подделка';
  win.URL.revokeObjectURL = () => {};
  const realClick = win.HTMLAnchorElement.prototype.click;
  win.HTMLAnchorElement.prototype.click = function () {
    if (this.download) state.anchors++;
    else if (realClick) realClick.call(this);
  };

  /* ── сеть релея (ntfy-совместимая) ───────────────────────────────────── */
  const encoder = new TextEncoder();
  const sseStream = () => {
    const queue = [];
    const waiters = [];
    state.sseQueues.push({ push: (text) => {
      const item = encoder.encode(text);
      if (waiters.length) waiters.shift()({ value: item, done: false });
      else queue.push(item);
    } });
    return {
      getReader: () => ({
        read: () => (queue.length ? Promise.resolve({ value: queue.shift(), done: false }) : new Promise((res) => waiters.push(res))),
        cancel: () => Promise.resolve(),
      }),
    };
  };

  win.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (opts.method === 'POST') {
      /* тело — запечатанный кадр; адрес вида https://релей/<тема> */
      state.published.push({ topic: u.split('/').pop().split('?')[0], body: String(opts.body || '') });
      return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '' };
    }
    if (u.includes('/sse')) {
      return { ok: true, status: 200, body: sseStream() };
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };

  win.navigator.clipboard = { writeText: async () => true, readText: async () => '' };
  win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

  /* ── помощники наружу ────────────────────────────────────────────────── */
  state.pushRemote = async (obj, secret) => {
    /* шифруем «как чужой участник» и кладём в поток релея */
    const sealed = await sealWith(secret, obj);
    state.sseQueues.forEach((q) => q.push('data: ' + JSON.stringify({ id: 'f' + Math.random().toString(36).slice(2, 8), event: 'message', message: sealed }) + '\n\n'));
  };
  state.makeStream = makeStream;
  state.FakePC = FakePC;
  return state;
}

/** Запечатать кадр так же, как это делает приложение (AES-GCM, ключ из секрета). */
export async function sealWith(secret, obj, counter = 0) {
  const enc = new TextEncoder();
  const digest = await webcrypto.subtle.digest('SHA-256', enc.encode('bridge-call|' + secret));
  const key = await webcrypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = new Uint8Array(12);
  iv[0] = 0;
  iv[1] = (counter >>> 24) & 255;
  iv[2] = (counter >>> 16) & 255;
  iv[3] = (counter >>> 8) & 255;
  iv[4] = counter & 255;
  const buf = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  const out = new Uint8Array(12 + buf.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(buf), 12);
  return 'b1.' + Buffer.from(out).toString('base64url');
}

/** Расшифровать то, что приложение отправило на релей. */
export async function openWith(secret, text) {
  try {
    const raw = Buffer.from(String(text).slice(3), 'base64url');
    const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode('bridge-call|' + secret));
    const key = await webcrypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['decrypt']);
    const plain = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12) }, key, raw.subarray(12));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null;
  }
}
