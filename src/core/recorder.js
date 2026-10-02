/**
 * Запись разговора: сетка участников + звук всех в один файл.
 * Собирается прямо в браузере — ни сервер, ни облако в этом не участвуют.
 */
import { chooseRecorderMime } from './media.js';

const LAYOUT = { cols: 2, rows: 2 };

export class Recorder {
  constructor({ onTick, onDone, onLog } = {}) {
    this.onTick = onTick || (() => {});
    this.onDone = onDone || (() => {});
    this.onLog = onLog || (() => {});
    this.active = false;
    this.chunks = [];
  }

  /**
   * @param {object} o
   * @param {Array<{av:string,name:string,el:HTMLVideoElement|null}>} o.tiles
   * @param {MediaStream[]} o.audioStreams
   * @param {MediaStream|null} o.audio   свой микрофон
   * @param {number} [o.fps]
   * @param {object} [o.me]              { name }
   */
  async start({ tiles = [], audioStreams = [], audio = null, fps = 30, me = null } = {}) {
    if (this.active) return { ok: false, error: 'запись уже идёт' };
    const mime = chooseRecorderMime();
    if (!mime || typeof MediaRecorder === 'undefined') {
      return { ok: false, error: 'этот браузер не умеет записывать видео' };
    }
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');
    this.tiles = tiles;
    this.ctx = ctx;
    this.canvas = canvas;

    /* звук: складываем все дорожки в один поток */
    this.audioCtx = null;
    this.nodes = [];
    let mixed = null;
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new Ctor({ latencyHint: 'playback' });
      const dest = this.audioCtx.createMediaStreamDestination();
      const all = [...audioStreams, ...(audio ? [audio] : [])].filter(Boolean);
      all.forEach((s) => {
        if (!s || !s.getAudioTracks().length) return;
        try {
          const src = this.audioCtx.createMediaStreamSource(s);
          const gain = this.audioCtx.createGain();
          gain.gain.value = 1 / Math.max(1, Math.min(4, all.length));
          src.connect(gain).connect(dest);
          this.nodes.push(src, gain);
        } catch {
          /* поток без звука — пропускаем */
        }
      });
      mixed = dest.stream;
    } catch {
      mixed = null;
    }

    const videoStream = canvas.captureStream(Number(fps) || 30);
    const out = new MediaStream([...videoStream.getVideoTracks(), ...((mixed && mixed.getAudioTracks()) || [])]);
    this.stream = out;
    const draw = () => {
      if (!this.active) return;
      this.draw(ctx, canvas.width, canvas.height, me);
      this.raf = requestAnimationFrame(draw);
    };

    try {
      this.rec = new MediaRecorder(out, { mimeType: mime, videoBitsPerSecond: 2_800_000, audioBitsPerSecond: 96_000 });
    } catch (e) {
      return { ok: false, error: 'запись не запустилась: ' + (e.message || e) };
    }
    this.rec.ondataavailable = (ev) => {
      if (ev.data && ev.data.size) this.chunks.push(ev.data);
    };
    this.rec.onstop = () => {
      const blob = new Blob(this.chunks, { type: mime.split(';')[0] });
      this.chunks = [];
      this.onDone(blob, mime);
    };
    this.startedAt = Date.now();
    this.rec.start(1000);
    this.active = true;
    this.raf = requestAnimationFrame(draw);
    this.ticker = setInterval(() => this.onTick(Date.now() - this.startedAt, this.chunks.reduce((n, c) => n + c.size, 0)), 1000);
    return { ok: true, mime };
  }

  /** Кадр: чёрный фон, плитки с именами, полоска состояния. */
  draw(ctx, W, H, me) {
    const live = (this.tiles || []).filter((t) => t && t.el && t.el.videoWidth && t.el.isConnected !== false);
    ctx.fillStyle = '#14161a';
    ctx.fillRect(0, 0, W, H);
    const n = Math.max(1, live.length);
    const cols = n === 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
    const rows = Math.ceil(n / cols);
    const gw = W / cols;
    const gh = H / rows;
    const pad = 8;
    live.forEach((t, i) => {
      const x = (i % cols) * gw;
      const y = Math.floor(i / cols) * gh;
      const boxW = gw - pad * 2;
      const boxH = gh - pad * 2;
      const vw = t.el.videoWidth;
      const vh = t.el.videoHeight;
      const scale = Math.min(boxW / vw, boxH / vh);
      const dw = vw * scale;
      const dh = vh * scale;
      const dx = x + pad + (boxW - dw) / 2;
      const dy = y + pad + (boxH - dh) / 2;
      try {
        if (t.mirror) {
          ctx.save();
          ctx.translate(dx + dw, dy);
          ctx.scale(-1, 1);
          ctx.drawImage(t.el, 0, 0, dw, dh);
          ctx.restore();
        } else {
          ctx.drawImage(t.el, dx, dy, dw, dh);
        }
      } catch {
        /* кадр ещё не готов */
      }
      /* подпись */
      const label = (t.screen ? 'экран · ' : '') + String(t.name || 'Гость');
      ctx.font = '600 20px -apple-system, "Segoe UI", Roboto, sans-serif';
      const w = ctx.measureText(label).width + 24;
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.beginPath();
      const ly = dy + dh - 34;
      ctx.roundRect ? ctx.roundRect(dx + 8, ly, w, 28, 6) : ctx.rect(dx + 8, ly, w, 28);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(label, dx + 20, ly + 20);
    });
    if (!live.length) {
      ctx.fillStyle = '#8b93a7';
      ctx.font = '600 26px -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.fillText('Bridge · идёт запись', 32, 48);
    }
    /* метка записи */
    ctx.fillStyle = '#f23f43';
    ctx.beginPath();
    ctx.arc(W - 34, 34, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '700 18px -apple-system, "Segoe UI", Roboto, sans-serif';
    const time = ((Date.now() - (this.startedAt || Date.now())) / 1000) | 0;
    const mm = String(Math.floor(time / 60)).padStart(2, '0');
    const ss = String(time % 60).padStart(2, '0');
    ctx.fillText('REC ' + mm + ':' + ss, W - 132, 41);
  }

  stop() {
    if (!this.active) return false;
    this.active = false;
    clearInterval(this.ticker);
    cancelAnimationFrame(this.raf);
    try {
      this.rec.stop();
    } catch {
      /* уже */
    }
    try {
      this.nodes.forEach((n) => n.disconnect());
      if (this.audioCtx) this.audioCtx.close();
      this.stream.getTracks().forEach((t) => t.stop());
    } catch {
      /* уже */
    }
    return true;
  }
}

/** Имя файла записи: понятное и без мусора. */
export function recordingName(room, ext = 'webm') {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `bridge-${String(room || 'комната').replace(/[^\w-]+/g, '_')}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}.${ext}`;
}

export { LAYOUT };
