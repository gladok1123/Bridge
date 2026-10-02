/**
 * Транспорт сигналинга Bridge.
 *
 * Звонок соединяется напрямую (P2P, WebRTC). Чтобы участники нашли друг друга,
 * нужен маленький релей: он передаёт только зашифрованные кадры знакомства
 * (кто в комнате, SDP, ICE) — сам звук, видео и содержимое чата идут мимо него.
 *
 * Поддерживаются два вида релея:
 *   • SSE + POST (по умолчанию — публичный ntfy.sh, работает без своего сервера,
 *     без CORS-проблем и без хостинга; подходит и для Vercel);
 *   • свой WebSocket (relay/server.js) — если нужен полностью автономный контур.
 *
 * Если свой сокет не отвечает, канал сам переключается на публичный, а при
 * обрыве потока — переподключается с нарастающей паузой. Это видно в интерфейсе.
 */
import { seal, open, topicFor } from './crypto.js';
import { ENV } from './config.js';

export const DEFAULT_BASES = [ENV.relayUrl, 'https://ntfy.sh'].filter((v, i, a) => v && a.indexOf(v) === i);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class RelayLink {
  /**
   * @param {object} o
   * @param {(data:object, meta:object)=>void} o.onFrame  расшифрованный кадр
   * @param {(st:object)=>void} [o.onStatus]              состояние канала
   */
  constructor({ onFrame, onStatus, onLog } = {}) {
    this.onFrame = onFrame;
    this.onStatus = onStatus;
    this.onLog = onLog;
    this.state = { mode: 'idle', base: '', ok: false, error: '', tries: 0, sent: 0, got: 0, since: 0 };
    this.stopped = true;
    this.counter = 0;
    this.seen = new Set();
    this.seenOrder = [];
  }

  get status() {
    return { ...this.state };
  }

  #say(text, kind = 'info') {
    if (this.onLog) this.onLog(text, kind);
  }

  #set(patch) {
    this.state = { ...this.state, ...patch, since: Date.now() };
    if (this.onStatus) this.onStatus(this.status);
  }

  /**
   * Запустить канал.
   * @param {object} o
   * @param {string} o.room    код комнаты
   * @param {string} o.secret  секрет комнаты (для шифрования темы и кадров)
   * @param {string} [o.wsUrl] адрес своего релея
   * @param {string[]} [o.bases] публичные релеи по порядку
   */
  async start({ room, secret, wsUrl = '', bases = DEFAULT_BASES }) {
    this.stop();
    this.room = room;
    this.secret = secret;
    this.wsUrl = String(wsUrl || ENV.wsRelay || '').trim();
    this.bases = bases.length ? bases : DEFAULT_BASES;
    this.stopped = false;
    this.counter = 0;
    this.topic = await topicFor(room, secret);

    if (this.wsUrl) {
      const ok = await this.#trySocket();
      if (ok) return;
      this.#say('свой релей не ответил — перехожу на публичный', 'warn');
    }
    this.baseIdx = 0;
    this.#set({ mode: 'sse', base: this.bases[0], ok: false, error: '' });
    this.loop = this.#sseLoop();
  }

  /** Отправить кадр (объект). Возвращает true, если удалось. */
  async send(obj) {
    if (this.stopped) return false;
    let payload;
    try {
      payload = await seal(this.secret, obj, ++this.counter);
    } catch (e) {
      this.#say('не смог зашифровать кадр: ' + e.message, 'bad');
      return false;
    }
    if (this.sock && this.sock.readyState === 1) {
      try {
        this.sock.send(JSON.stringify({ r: this.room, p: payload }));
        this.#set({ mode: 'ws', ok: true, sent: this.state.sent + 1, error: '' });
        return true;
      } catch (e) {
        this.#say('свой релей отвалился: ' + e.message, 'warn');
        this.#dropSocket();
      }
    }
    const base = this.state.base || this.bases[0];
    try {
      const res = await fetch(base + '/' + this.topic, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: payload,
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      this.#set({ ok: true, sent: this.state.sent + 1, error: '' });
      return true;
    } catch (e) {
      this.#set({ ok: false, error: String(e.message || e) });
      this.#say('кадр не ушёл: ' + (e.message || e), 'bad');
      return false;
    }
  }

  stop() {
    this.stopped = true;
    this.#dropSocket();
    if (this.ctrl) {
      try { this.ctrl.abort(); } catch { /* уже */ }
      this.ctrl = null;
    }
    this.#set({ mode: 'off', ok: false });
  }

  /* ── свой WebSocket ──────────────────────────────────────────────────── */

  #dropSocket() {
    if (this.sock) {
      try { this.sock.onclose = this.sock.onerror = this.sock.onmessage = this.sock.onopen = null; this.sock.close(); } catch { /* уже */ }
      this.sock = null;
    }
    if (this.ping) {
      clearInterval(this.ping);
      this.ping = 0;
    }
  }

  #trySocket() {
    return new Promise((resolve) => {
      let settled = false;
      let sock;
      try {
        sock = new WebSocket(this.wsUrl);
      } catch {
        resolve(false);
        return;
      }
      const fail = () => {
        if (settled) return;
        settled = true;
        resolve(false);
      };
      const timer = setTimeout(fail, 3500);
      sock.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.sock = sock;
        sock.send(JSON.stringify({ r: this.room, hello: 1 }));
        this.#set({ mode: 'ws', base: this.wsUrl, ok: true, error: '' });
        this.#say('канал через свой релей', 'ok');
        this.ping = setInterval(() => {
          try { sock.send(JSON.stringify({ r: this.room, ping: 1 })); } catch { /* переподключимся */ }
        }, 20000);
        sock.onmessage = (ev) => {
          try {
            const m = JSON.parse(ev.data);
            if (m && m.p) this.#frame(m.p, m.i);
          } catch { /* мусор игнорируем */ }
        };
        sock.onclose = () => {
          this.#dropSocket();
          if (!this.stopped) {
            this.#say('свой релей закрыл соединение — перехожу на публичный', 'warn');
            this.baseIdx = 0;
            this.#set({ mode: 'sse', base: this.bases[0], ok: false });
            this.loop = this.#sseLoop();
          }
        };
        sock.onerror = () => { /* закроется сам */ };
        resolve(true);
      };
      sock.onerror = () => {
        clearTimeout(timer);
        fail();
      };
      sock.onclose = () => {
        clearTimeout(timer);
        fail();
      };
    });
  }

  /* ── публичный релей (SSE + POST) ────────────────────────────────────── */

  async #sseLoop() {
    while (!this.stopped) {
      const base = this.bases[this.baseIdx % this.bases.length];
      try {
        const ctrl = new AbortController();
        this.ctrl = ctrl;
        const res = await fetch(base + '/' + this.topic + '/sse?since=45s', {
          headers: { accept: 'text/event-stream' },
          signal: ctrl.signal,
          cache: 'no-store',
        });
        if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
        this.#set({ mode: 'sse', base, ok: true, error: '', tries: 0 });
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let cut;
          while ((cut = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, cut).replace(/\r$/, '');
            buf = buf.slice(cut + 1);
            if (!line.startsWith('data:')) continue;
            const text = line.slice(5).trim();
            if (!text) continue;
            try {
              const ev = JSON.parse(text);
              if (ev && ev.event === 'message' && ev.message) this.#frame(ev.message, ev.id);
            } catch { /* не наше */ }
          }
        }
        throw new Error('поток закрыт');
      } catch (e) {
        if (this.stopped) break;
        this.tries = (this.state.tries || 0) + 1;
        this.#set({ ok: false, error: String(e.message || e), tries: this.tries, base });
        if (this.tries === 2) this.#say('релей молчит, пробую дальше: ' + (e.message || e), 'warn');
        await sleep(Math.min(5000, 400 * this.tries));
        this.baseIdx = (this.baseIdx + 1) % this.bases.length;
      }
    }
  }

  /* ── приём ───────────────────────────────────────────────────────────── */

  async #frame(payload, id) {
    if (id) {
      if (this.seen.has(id)) return;
      this.seen.add(id);
      this.seenOrder.push(id);
      if (this.seenOrder.length > 600) this.seen.delete(this.seenOrder.shift());
    }
    const data = await open(this.secret, payload);
    if (!data) return;                       // чужой ключ или подделка
    if (data.from && data.from === this.me) return;   // своё эхо
    this.#set({ got: this.state.got + 1 });
    if (this.onFrame) this.onFrame(data, { id, base: this.state.base });
  }

  /** Кто мы в этом канале — нужно, чтобы не обрабатывать собственные кадры. */
  setMe(id) {
    this.me = id;
  }
}
