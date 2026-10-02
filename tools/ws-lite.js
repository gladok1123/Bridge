/**
 * ws-lite.js — крошечный клиент WebSocket для проверок (в Node 20 нет своего).
 * Только то, что нужно тестам: подключиться, отправить текст, получить текст.
 */
'use strict';

const net = require('net');
const tls = require('tls');
const crypto = require('crypto');

class WSLite {
  constructor(url) {
    const m = String(url).match(/^(wss?):\/\/([^:/]+)(?::(\d+))?(\/.*)?$/);
    if (!m) throw new Error('плохой адрес: ' + url);
    this.secure = m[1] === 'wss';
    this.host = m[2];
    this.port = Number(m[3] || (this.secure ? 443 : 80));
    this.path = (m[4] || '/') + (m[3] ? '' : '');
    this.buffer = Buffer.alloc(0);
    this.open = false;
    this.onText = null;
    this.onOpen = null;
    this.onClose = null;
  }

  connect(extraHeaders) {
    return new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString('base64');
      const headers = Object.assign({}, extraHeaders || {});
      const onConnect = () => {
        let head = 'GET ' + this.path + ' HTTP/1.1\r\n' +
          'Host: ' + this.host + (this.port === 443 || this.port === 80 ? '' : ':' + this.port) + '\r\n' +
          'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
          'Sec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n';
        Object.keys(headers).forEach((k) => { head += k + ': ' + headers[k] + '\r\n'; });
        this.socket.write(head + '\r\n');
      };
      this.socket = this.secure
        ? tls.connect({ host: this.host, port: this.port, servername: this.host }, onConnect)
        : net.connect(this.port, this.host, onConnect);
      this.socket.on('error', reject);
      this.socket.on('data', (chunk) => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        if (!this.open) {
          const idx = this.buffer.indexOf('\r\n\r\n');
          if (idx === -1) return;
          const head = this.buffer.slice(0, idx).toString('latin1');
          if (!/101/.test(head.split('\r\n')[0])) { reject(new Error('нет 101: ' + head.split('\r\n')[0])); return; }
          this.buffer = this.buffer.slice(idx + 4);
          this.open = true;
          if (this.onOpen) this.onOpen();
          resolve(this);
        }
        this.parse();
      });
      this.socket.on('close', () => { this.open = false; if (this.onClose) this.onClose(); });
    });
  }

  parse() {
    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0], b1 = this.buffer[1];
      const opcode = b0 & 0x0f;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buffer.length < 4) return; len = this.buffer.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buffer.length < 10) return; len = Number(this.buffer.readBigUInt64BE(2)); off = 10; }
      if (this.buffer.length < off + len) return;
      const payload = this.buffer.slice(off, off + len);
      this.buffer = this.buffer.slice(off + len);
      if (opcode === 0x1 && this.onText) this.onText(payload.toString('utf8'));
      if (opcode === 0x9) this.sendFrame(0xA, payload);
    }
  }

  sendFrame(opcode, payload) {
    const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    const len = data.length;
    let header;
    if (len < 126) { header = Buffer.alloc(2); header[1] = 0x80 | len; }
    else if (len < 65536) { header = Buffer.alloc(4); header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
    else { header = Buffer.alloc(10); header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2); }
    header[0] = 0x80 | opcode;
    const mask = crypto.randomBytes(4);
    const masked = Buffer.from(data);
    for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
    this.socket.write(Buffer.concat([header, mask, masked]));
  }

  send(obj) { this.sendFrame(0x1, Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj))); }
  close() { try { this.sendFrame(0x8, Buffer.alloc(0)); } catch (e) { /* уже */ } try { this.socket.end(); } catch (e) { /* уже */ } }

  /**
   * Ждём сообщение, подходящее под условие.
   * Сначала просматриваем уже полученные (их могло собрать другое подписывание),
   * потом слушаем новые — иначе легко пропустить то, что пришло «пока ждали другого».
   */
  wait(cond, ms) {
    if (this._from == null) this._from = 0;
    for (let i = this._from; i < this.seen.length; i++) {
      if (!cond || cond(this.seen[i])) {
        const hit = this.seen[i];
        this._from = i + 1;
        return Promise.resolve(hit);
      }
    }
    return new Promise((resolve, reject) => {
      const prev = this.onText;
      const timer = setTimeout(() => { this.onText = prev; reject(new Error('ждали сообщение — не пришло')); }, ms || 3000);
      this.onText = (text) => {
        let obj = null;
        try { obj = JSON.parse(text); } catch (e) { return; }
        this.seen.push(obj);
        if (!cond || cond(obj)) {
          clearTimeout(timer);
          this.onText = prev;
          this._from = this.seen.length;
          resolve(obj);
        }
      };
    });
  }
}

function client(url) {
  const c = new WSLite(url);
  c.seen = [];
  const orig = c.parse.bind(c);
  c.parse = () => { orig(); };
  return c;
}

module.exports = { WSLite, client };
