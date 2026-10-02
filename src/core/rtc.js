/**
 * Сетка соединений (mesh) Bridge.
 *
 * Каждый участник соединяется с каждым напрямую — WebRTC, P2P. Сервер (наш
 * маленький релей сигналинга) участвует только в знакомстве: передаёт
 * зашифрованные SDP и ICE-кандидатов. Звук, видео, чат и доска дальше идут
 * напрямую между браузерами, и ни один сервер их не видит.
 *
 * Переговоры сделаны «вежливыми» (perfect negotiation): без гонок, когда оба
 * участника одновременно предлагают свои параметры.
 */
import { attachMeter, detachMeter, tuneSender, retuneTrack, applyContentHint } from './media.js';

/** Настройки отправки по умолчанию: камера — 720p30, показ экрана — 1080p30. */
export const DEFAULT_TUNING = {
  cam: { quality: 720, fps: 30, bitrate: 0, hint: 'auto' },
  screen: { quality: 1080, fps: 30, bitrate: 0, hint: 'auto' },
};

export class Mesh {
  /**
   * @param {object} o
   * @param {RTCIceServer[]} o.iceServers
   * @param {string} o.selfAv
   * @param {(av:string, msg:object)=>void} o.onSignal   кадр для отправки напарнику
   * @param {(av:string, patch:object)=>void} o.onPeer   состояние напарника
   * @param {(av:string, info:object)=>void} o.onTrack   пришла дорожка
   * @param {(av:string, obj:object)=>void} o.onData    сообщение из прямого канала
   * @param {(av:string, level:number)=>void} o.onLevel громкость
   * @param {(list:object[])=>void} o.onStats
   * @param {(text:string, kind?:string)=>void} [o.onLog]
   */
  constructor({ iceServers, selfAv, onSignal, onPeer, onTrack, onData, onLevel, onStats, onLog }) {
    this.iceServers = iceServers || [];
    this.selfAv = selfAv;
    this.onSignal = onSignal || (() => {});
    this.onPeer = onPeer || (() => {});
    this.onTrack = onTrack || (() => {});
    this.onData = onData || (() => {});
    this.onLevel = onLevel || (() => {});
    this.onStats = onStats || (() => {});
    this.onLog = onLog || (() => {});
    this.peers = new Map();
    this.local = { mic: null, cam: null, scr: null };   // MediaStream или null
    this.kinds = { mic: true, cam: false, screen: false };
    this.tuning = {
      cam: { ...DEFAULT_TUNING.cam },
      screen: { ...DEFAULT_TUNING.screen },
    };
    this.statsTimer = 0;
    this.closed = false;
  }

  log(text, kind = 'info') {
    this.onLog(text, kind);
  }

  /** Свой позывной — он же решает, кто предлагает первым (меньший). */
  setSelf(av) {
    this.selfAv = av;
  }

  /* ── участники ───────────────────────────────────────────────────────── */

  async addPeer(av, name = '') {
    if (!av || av === this.selfAv || this.closed) return null;
    if (this.peers.has(av)) {
      const p = this.peers.get(av);
      if (name) p.name = name;
      return p;
    }
    const p = {
      av,
      name,
      polite: this.selfAv > av,          // лексикографически больший уступает
      pc: null,
      dc: null,
      dcOpen: false,
      senders: { mic: null, cam: null },
      remote: { audio: null, video: null },
      makingOffer: false,
      pendingIce: [],
      pendingData: [],
      connected: false,
      level: 0,
      stats: {},
    };
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      iceCandidatePoolSize: 2,
    });
    p.pc = pc;

    /* звук: одна дорожка, видео: одна дорожка. Демонстрация подменяет видео. */
    try {
      p.senders.mic = pc.addTransceiver('audio', { direction: 'sendrecv' }).sender;
      p.senders.cam = pc.addTransceiver('video', { direction: 'sendrecv' }).sender;
      /* если в этот момент идёт показ экрана — сразу берём настройки экрана */
      await tuneSender(p.senders.cam, this.#tuningFor(this.kinds.screen ? 'screen' : 'cam'));
    } catch (e) {
      this.log('не смог подготовить дорожки: ' + (e.message || e), 'bad');
    }
    this.applyLocalTo(p);

    pc.onnegotiationneeded = async () => {
      try {
        p.makingOffer = true;
        await pc.setLocalDescription();
        this.onSignal(av, { t: 'sdp', sdp: pc.localDescription, polite: p.polite });
      } catch (e) {
        if (!/stable|closed/i.test(String(e.message || ''))) this.log('сбой переговоров: ' + (e.message || e), 'bad');
      } finally {
        p.makingOffer = false;
      }
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate) this.onSignal(av, { t: 'ice', c: ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate });
    };

    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      p.connected = st === 'connected';
      this.onPeer(av, { connection: st, connected: p.connected });
      if (st === 'failed') {
        this.log('связь с участником сорвалась — пробую перезапустить', 'warn');
        try { pc.restartIce(); } catch { /* не вышло — переподключимся по сигналу */ }
      }
    };

    pc.oniceconnectionstatechange = () => {
      this.onPeer(av, { ice: pc.iceConnectionState });
    };

    pc.ontrack = (ev) => {
      const kind = ev.track.kind;
      const stream = (ev.streams && ev.streams[0]) || new MediaStream();
      if (!stream.getTracks().includes(ev.track)) stream.addTrack(ev.track);
      p.remote[kind === 'audio' ? 'audio' : 'video'] = stream;
      if (kind === 'audio') {
        const read = attachMeter(stream);
        if (read) {
          p.read = read;
          this.ensureMeterLoop();
        }
      }
      this.onTrack(av, { kind, stream });
    };

    pc.ondatachannel = (ev) => {
      this.wireData(av, ev.channel);
    };

    /* участник встаёт в список до создания канала: иначе обработчики
       канала не к чему привязать и прямой обмен молча не заработает */
    this.peers.set(av, p);

    if (!p.polite) {
      // предлагающий создаёт канал заранее: он же становится «первым» звеном
      this.wireData(av, pc.createDataChannel('bridge', { ordered: true }));
    }

    if (p.polite) {
      // вежливая сторона ничего не предлагает — ждёт предложение, но при этом
      // сама должна сообщить о себе, иначе напарник не знает, что мы здесь
      this.onSignal(av, { t: 'here' });
    }
    this.ensureStatsLoop();
    return p;
  }

  wireData(av, dc) {
    const p = this.peers.get(av);
    if (!p || p.dc === dc) return;
    p.dc = dc;
    try {
      dc.binaryType = 'arraybuffer';
    } catch {
      /* не критично */
    }
    dc.onopen = () => {
      p.dcOpen = true;
      this.onPeer(av, { dc: true, connection: p.pc.connectionState });
      p.pendingData.splice(0).forEach((obj) => this.sendRaw(p, obj));
      this.log('прямой канал с участником открыт', 'ok');
    };
    dc.onclose = () => {
      p.dcOpen = false;
      this.onPeer(av, { dc: false });
    };
    dc.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      let obj;
      try {
        obj = JSON.parse(ev.data);
      } catch {
        return;
      }
      this.onData(av, obj);
    };
  }

  removePeer(av, reason = '') {
    const p = this.peers.get(av);
    if (!p) return;
    this.peers.delete(av);
    if (p.remote.audio) detachMeter(p.remote.audio);
    if (p.read) p.read = null;
    try {
      if (p.dc) {
        p.dc.onopen = p.dc.onmessage = p.dc.onclose = null;
        p.dc.close();
      }
      p.pc.onnegotiationneeded = p.pc.onicecandidate = p.pc.ontrack = p.pc.ondatachannel = null;
      p.pc.onconnectionstatechange = p.pc.oniceconnectionstatechange = null;
      p.pc.getSenders().forEach((s) => { try { s.replaceTrack(null); } catch { /* уже */ } });
      p.pc.close();
    } catch {
      /* уже закрыт */
    }
    if (!this.peers.size) {
      clearInterval(this.statsTimer);
      this.statsTimer = 0;
    }
    this.log('участник отключён' + (reason ? ': ' + reason : ''), 'warn');
  }

  /* ── сигналинг ───────────────────────────────────────────────────────── */

  async onRemote(av, frame) {
    if (!frame || this.closed) return;
    let p = this.peers.get(av);
    if (!p) {
      if (frame.t === 'sdp' || frame.t === 'ice' || frame.t === 'here') p = await this.addPeer(av, '');
      if (!p) return;
    }
    if (frame.t === 'here') {
      // напарник вежливый и ждёт предложение — предлагаем ему сами,
      // но только если ещё ничего не предложили
      if (!p.polite && p.pc.signalingState === 'stable' && !p.makingOffer) {
        try {
          await p.pc.setLocalDescription();
          this.onSignal(av, { t: 'sdp', sdp: p.pc.localDescription, polite: p.polite });
        } catch { /* предложение уйдёт само из onnegotiationneeded */ }
      }
      return;
    }
    if (frame.t === 'ice') {
      if (!p.pc.remoteDescription) {
        p.pendingIce.push(frame.c);
        return;
      }
      try {
        await p.pc.addIceCandidate(frame.c);
      } catch (e) {
        if (!/closed/i.test(String(e.message || ''))) this.log('кандидат не принят: ' + (e.message || e), 'warn');
      }
      return;
    }
    if (frame.t === 'sdp') {
      const desc = frame.sdp;
      if (!desc) return;
      const collision = desc.type === 'offer' && (p.makingOffer || p.pc.signalingState !== 'stable');
      if (collision && !p.polite) return;             // уступаем только вежливые
      try {
        await p.pc.setRemoteDescription(desc);
        const flush = p.pendingIce.splice(0);
        for (const c of flush) {
          try { await p.pc.addIceCandidate(c); } catch { /* старый кандидат */ }
        }
        if (desc.type === 'offer') {
          await p.pc.setLocalDescription();
          this.onSignal(av, { t: 'sdp', sdp: p.pc.localDescription, polite: p.polite });
        }
      } catch (e) {
        this.log('не сложились параметры соединения: ' + (e.message || e), 'bad');
      }
    }
  }

  /* ── свои дорожки ────────────────────────────────────────────────────── */

  /** Поставить поток в слот: 'mic' | 'cam' | 'scr'. null — выключить. */
  async setLocal(kind, stream) {
    if (kind === 'scr') {
      // демонстрация занимает видео-дорожку: у всех появляется картинка экрана
      this.kinds.screen = !!stream;
      this.local.scr = stream || null;      // иначе качество и подсказка кодировщику теряются
      await this.#pushVideo(this.local.scr || (this.kinds.cam ? this.local.cam : null));
      return;
    }
    if (kind === 'mic') {
      this.kinds.mic = !!stream;
      this.local.mic = stream || null;
      for (const p of this.peers.values()) {
        try { await p.senders.mic.replaceTrack(this.local.mic ? this.local.mic.getAudioTracks()[0] || null : null); } catch { /* уже */ }
      }
      return;
    }
    if (kind === 'cam') {
      this.kinds.cam = !!stream;
      this.local.cam = stream || null;
      if (!this.kinds.screen) await this.#pushVideo(this.local.cam);
    }
  }

  async #pushVideo(stream) {
    const track = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] || null : null;
    /* показ экрана идёт отдельным качеством, камера — своим */
    const kind = this.kinds.screen ? 'screen' : 'cam';
    const tuning = this.#tuningFor(kind, track);
    applyContentHint(track, { kind, hint: tuning.hint });
    for (const p of this.peers.values()) {
      try {
        await p.senders.cam.replaceTrack(track);
      } catch { /* уже */ }
      await tuneSender(p.senders.cam, tuning);
    }
  }

  /** Настройки отправки для текущего источника. */
  #tuningFor(kind, track = null) {
    const t = (this.tuning && this.tuning[kind]) || DEFAULT_TUNING[kind] || DEFAULT_TUNING.cam;
    const src = track || (kind === 'screen'
      ? (this.local.scr && this.local.scr.getVideoTracks()[0]) || null
      : (this.local.cam && this.local.cam.getVideoTracks()[0]) || null);
    return { kind, quality: t.quality, fps: t.fps, bitrate: t.bitrate, hint: t.hint, track: src };
  }

  /**
   * Сменить качество на ходу: применяем и к отправителям, и к самим дорожкам
   * (браузер тогда реально меняет разрешение захвата, а не просто «режет» поток).
   */
  async setTuning(partial) {
    if (!partial) return;
    if (partial.cam) this.tuning.cam = { ...this.tuning.cam, ...partial.cam };
    if (partial.screen) this.tuning.screen = { ...this.tuning.screen, ...partial.screen };
    for (const p of this.peers.values()) {
      const kind = this.kinds.screen ? 'screen' : 'cam';
      await tuneSender(p.senders.cam, this.#tuningFor(kind));
    }
    /* свои дорожки: подсказка кодировщику нужна всегда, даже если мы пока одни
       в комнате, а разрешение меняем только у активного источника */
    const camTrack = this.local.cam && this.local.cam.getVideoTracks()[0];
    if (camTrack) {
      applyContentHint(camTrack, { kind: 'cam' });
      if (!this.kinds.screen) await retuneTrack(camTrack, this.tuning.cam);
    }
    const scrTrack = this.local.scr && this.local.scr.getVideoTracks()[0];
    if (scrTrack) {
      applyContentHint(scrTrack, { kind: 'screen', hint: this.tuning.screen.hint });
      await retuneTrack(scrTrack, this.tuning.screen);
    }
  }

  async applyLocalTo(p) {
    try {
      const mic = this.local.mic && this.local.mic.getAudioTracks()[0];
      const video = this.kinds.screen
        ? this.local.scr && this.local.scr.getVideoTracks()[0]
        : this.kinds.cam && this.local.cam && this.local.cam.getVideoTracks()[0];
      await p.senders.mic.replaceTrack(mic || null);
      await p.senders.cam.replaceTrack(video || null);
    } catch {
      /* заменим при следующем обновлении */
    }
  }

  /* ── данные по прямому каналу ────────────────────────────────────────── */

  sendRaw(p, obj) {
    try {
      p.dc.send(JSON.stringify(obj));
      return true;
    } catch {
      return false;
    }
  }

  /** Разослать всем. Возвращает список тех, кто получил напрямую. */
  broadcast(obj) {
    const reached = [];
    for (const [av, p] of this.peers) {
      if (p.dc && p.dcOpen) {
        if (this.sendRaw(p, obj)) reached.push(av);
      } else if (p.dc) {
        p.pendingData.push(obj);
      }
    }
    return reached;
  }

  get readyCount() {
    let n = 0;
    for (const p of this.peers.values()) if (p.dcOpen) n++;
    return n;
  }

  /* ── измерения ───────────────────────────────────────────────────────── */

  ensureMeterLoop() {
    if (this.meterTimer || this.closed) return;
    this.meterTimer = setInterval(() => {
      for (const [av, p] of this.peers) {
        if (p.read) {
          const lvl = p.read();
          p.level = lvl;
          this.onLevel(av, lvl);
        }
      }
    }, 250);
  }

  ensureStatsLoop() {
    if (this.statsTimer || this.closed) return;
    this.statsTimer = setInterval(() => this.collectStats(), 2000);
  }

  async collectStats() {
    if (this.closed || !this.peers.size) return;
    const out = [];
    const now = Date.now();
    for (const [av, p] of this.peers) {
      try {
        const report = await p.pc.getStats();
        let rtt = 0;
        let lost = 0;
        let jitter = 0;
        let candidateType = '';
        let framesPerSecond = 0;
        let frameWidth = 0;
        let frameHeight = 0;
        let inBytes = 0;
        let outBytes = 0;
        report.forEach((s) => {
          if (s.type === 'candidate-pair' && s.state === 'succeeded' && (s.nominated || s.selected)) {
            rtt = (s.currentRoundTripTime || 0) * 1000;
          }
          if (s.type === 'inbound-rtp') {
            inBytes += s.bytesReceived || 0;
            if (s.kind === 'audio') {
              jitter = (s.jitter || 0) * 1000;
              lost += s.packetsLost || 0;
            }
            if (s.kind === 'video') {
              framesPerSecond = s.framesPerSecond || framesPerSecond;
              frameWidth = s.frameWidth || frameWidth;
              frameHeight = s.frameHeight || frameHeight;
            }
          }
          if (s.type === 'outbound-rtp') outBytes += s.bytesSent || 0;
          if (s.type === 'local-candidate' && s.candidateType && !candidateType) candidateType = s.candidateType;
        });
        const dt = p.statAt ? Math.max(0.5, (now - p.statAt) / 1000) : 0;
        const inBps = p.statAt ? Math.max(0, ((inBytes - (p.statIn || 0)) / dt) * 8) : 0;
        const outBps = p.statAt ? Math.max(0, ((outBytes - (p.statOut || 0)) / dt) * 8) : 0;
        p.statAt = now;
        p.statIn = inBytes;
        p.statOut = outBytes;
        p.stats = { rtt, inBps, outBps, lost, candidateType, jitter, framesPerSecond, frameWidth, frameHeight };
        out.push({
          av,
          name: p.name,
          connected: p.connected,
          dcOpen: p.dcOpen,
          level: p.level,
          candidateType,
          rtt,
          inBps,
          outBps,
          lost,
          jitter,
          framesPerSecond,
          frameWidth,
          frameHeight,
        });
      } catch {
        /* пропускаем этот замер */
      }
    }
    if (out.length) this.onStats(out);
  }

  close() {
    this.closed = true;
    clearInterval(this.statsTimer);
    clearInterval(this.meterTimer);
    [...this.peers.keys()].forEach((av) => this.removePeer(av, 'выход'));
  }
}
