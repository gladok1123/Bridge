#!/usr/bin/env node
/**
 * Bridge — свой релей сигналинга (WebSocket, без зависимостей).
 *
 * Нужен, только если вы хотите полностью автономный контур: например, поднять
 * релей на домашнем компьютере или VPS и указать адрес в NEXT_PUBLIC_WS_RELAY.
 * По умолчанию Bridge работает через публичный релей и никакого сервера не просит.
 *
 * Что он делает: принимает зашифрованные кадры у участников одной комнаты
 * и раздаёт их остальным участникам той же комнаты. Ничего не расшифровывает,
 * ничего не хранит: содержимое ему недоступно в принципе.
 *
 * Запуск:  node relay/server.js  [порт]     (по умолчанию 8080)
 * Или:     npm run relay
 */
'use strict';

const http = require('http');
const crypto = require('crypto');

const PORT = Number(process.argv[2] || process.env.PORT || 8080);
const MAX_ROOM = 64;
const MAX_FRAME = 200 * 1024;      // запас на SDP с большим числом кандидатов
const MAX_PER_ROOM = 64;           // участников в комнате
const rooms = new Map();           // код комнаты → Set<ws>

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function log(...a) {
  const t = new Date().toLocaleTimeString('ru-RU');
  console.log('[' + t + ']', ...a);
}

/** Минимальный разбор кадров WebSocket: текст, закрытие, пинг. */
function makeSocket(sock) {
  const ws = {
    sock,
    alive: true,
    send(text) {
      const data = Buffer.from(text, 'utf8');
      const len = data.length;
      let head;
      if (len < 126) {
        head = Buffer.alloc(2);
        head[1] = len;
      } else if (len < 65536) {
        head = Buffer.alloc(4);
        head[1] = 126;
        head.writeUInt16BE(len, 2);
      } else {
        head = Buffer.alloc(10);
        head[1] = 127;
        head.writeBigUInt64BE(BigInt(len), 2);
      }
      head[0] = 0x81;               // FIN + текстовый кадр
      try { sock.write(Buffer.concat([head, data])); } catch { /* порвалось */ }
    },
    close() {
      try { sock.destroy(); } catch { /* уже */ }
    },
  };
  return ws;
}

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    let peers = 0;
    rooms.forEach((set) => { peers += set.size; });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: true, service: 'bridge-relay', rooms: rooms.size, peers, uptime: process.uptime() }));
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Bridge relay. Подключайтесь по WebSocket: /ws');
});

server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || !/websocket/i.test(String(req.headers.upgrade || ''))) {
    sock.destroy();
    return;
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  sock.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  sock.setNoDelay(true);

  const ws = makeSocket(sock);
  let room = null;
  let buf = Buffer.alloc(0);

  const leave = () => {
    if (!room) return;
    const set = rooms.get(room);
    if (set) {
      set.delete(ws);
      if (!set.size) rooms.delete(room);
    }
    room = null;
  };

  sock.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const op = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        off = 10;
      }
      if (len > MAX_FRAME) { ws.close(); return; }
      const need = off + (masked ? 4 : 0) + len;
      if (buf.length < need) return;
      let payload = buf.slice(off + (masked ? 4 : 0), off + (masked ? 4 : 0) + len);
      if (masked) {
        const mask = buf.slice(off, off + 4);
        const copy = Buffer.from(payload);
        for (let i = 0; i < copy.length; i++) copy[i] ^= mask[i & 3];
        payload = copy;
      }
      buf = buf.slice(need);

      if (op === 0x8) { leave(); ws.close(); return; }
      if (op === 0x9) {           // ping → pong
        const pong = Buffer.alloc(payload.length + 2);
        pong[0] = 0x8a;
        pong[1] = payload.length;
        payload.copy(pong, 2);
        try { sock.write(pong); } catch { /* уже */ }
        continue;
      }
      if (op !== 0x1) continue;   // двоичные кадры не используем
      if (!fin) continue;         // фрагментацию не поддерживаем: кадры маленькие

      let msg;
      try { msg = JSON.parse(payload.toString('utf8')); } catch { continue; }
      if (!msg || typeof msg !== 'object') continue;

      if (msg.hello) {
        if (room) continue;
        const code = String(msg.r || '').trim().slice(0, MAX_ROOM);
        if (!code) continue;
        let set = rooms.get(code);
        if (!set) {
          set = new Set();
          rooms.set(code, set);
        }
        if (set.size >= MAX_PER_ROOM) { ws.send(JSON.stringify({ err: 'room-full' })); ws.close(); return; }
        room = code;
        set.add(ws);
        log('в комнате', code, '—', set.size, 'участник(ов)');
        continue;
      }

      if (msg.ping) { ws.send(JSON.stringify({ pong: Date.now() })); continue; }
      if (msg.bye) { leave(); continue; }

      if (msg.p && room) {
        const set = rooms.get(room);
        if (!set) continue;
        const out = JSON.stringify({ r: room, p: String(msg.p).slice(0, MAX_FRAME) });
        set.forEach((peer) => { if (peer !== ws) peer.send(out); });
      }
    }
  });

  sock.on('close', () => { leave(); });
  sock.on('error', () => { leave(); });
});

// Если фрейм пришёл «в середине» — просто закрываем молча: так считает и RFC.
server.on('clientError', (err, sock) => {
  try { sock.destroy(); } catch { /* уже */ }
});

server.listen(PORT, '0.0.0.0', () => {
  log('Bridge relay слушает 0.0.0.0:' + PORT);
  log('Укажите адрес в .env.local:  NEXT_PUBLIC_WS_RELAY=ws://<ip-или-домен>:' + PORT + '/ws');
  log('Проверка:  curl http://localhost:' + PORT + '/health');
});
