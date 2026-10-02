'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon.jsx';
import { Avatar } from './Avatar.jsx';
import { fmtBitrate } from '@/lib/util.js';
import { QualityPopover } from './QualityPicker.jsx';
import { QUALITY } from '@/core/media.js';

/** Одна плитка: видео, имя, значки состояния и замеры. */
export function Tile({
  av, name, stream, speaking, mirrored, isScreen, isSelf, showStats, stats,
  pinned, onPin, onFullscreen, register, videoRefOut,
}) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (stream && el.srcObject !== stream) {
      el.srcObject = stream;
      const p = el.play && el.play();
      if (p && p.catch) p.catch(() => {});
    }
    if (!stream && el.srcObject) el.srcObject = null;
  }, [stream]);

  useEffect(() => {
    if (!register) return undefined;
    register(av, ref.current, { isSelf, isScreen, name });
    return () => register(av, null, { isSelf, isScreen, name });
  }, [register, av, isSelf, isScreen, name]);

  const hasVideo = !!stream;
  const cls = [
    'tile',
    hasVideo ? '' : 'tile--off',
    speaking ? 'tile--speaking' : '',
    mirrored ? 'tile--mirror' : '',
    isScreen ? 'tile--screen' : '',
    pinned ? 'tile--pinned' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={cls} onClick={() => onPin && onPin(av)}>
      <video ref={ref} autoPlay playsInline muted={isSelf} />
      {!hasVideo ? (
        <div className="tile__ph">
          <Avatar name={name} />
          <small>{isSelf ? 'камера выключена' : 'нет видео'}</small>
        </div>
      ) : null}
      {isScreen ? (
        <span className="tile__tag tile__tag--share">
          <Icon name="screen" size={12} /> экран
        </span>
      ) : null}
      {showStats && stats ? (
        <div className="tile__stats">
          {stats.rtt ? <span>{Math.round(stats.rtt)} мс</span> : null}
          {stats.outBps ? <span title="отдаём">{fmtBitrate(stats.outBps)}</span> : null}
          {stats.candidateType ? (
            <span title={stats.candidateType === 'relay' ? 'через TURN' : 'напрямую'}>
              {stats.candidateType === 'relay' ? 'TURN' : stats.candidateType === 'srflx' ? 'P2P·NAT' : 'P2P'}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="tile__bar">
        <span className="tile__name">{name}</span>
        <span className="tile__badges">
          {speaking ? <span className="tile__badge is-ok"><Icon name="volume" size={13} /></span> : null}
        </span>
      </div>
      <button
        className="tile__full iconbtn"
        onClick={(e) => { e.stopPropagation(); onFullscreen && onFullscreen(ref.current); }}
        title="На весь экран"
        aria-label="На весь экран"
      >
        <Icon name="fullscreen" size={18} />
      </button>
    </div>
  );
}

/**
 * Сцена: большая картинка того, кто показывает экран (или кого закрепили),
 * остальные — полосой снизу. Можно переключить на ровную сетку.
 */
export function Stage({
  me, peers, media, speaking, links, remoteStream, myStreams, register,
  layout, onLayout, pinned, onPin, showStats, recording, onStartRecord, onStopShare,
  onTurnOnCam, relayStatus, screenTuning, onScreenTuning,
}) {
  const [tick, setTick] = useState(0);

  /* раз в секунду обновляем замеры, чтобы цифры были живые */
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const entries = useMemo(() => {
    const out = [];
    peers.forEach((p) => {
      const st = (links && links[p.av]) || {};
      const remote = remoteStream(p.av, 'video');
      out.push({
        av: p.av,
        name: p.name,
        stream: p.screen ? remote : (p.cam ? remote : null),
        screen: !!p.screen,
        self: false,
        hand: !!p.hand,
        mic: !!p.mic,
        stats: st,
        connected: !!st.dcOpen || st.connection === 'connected',
      });
    });
    out.push({
      av: '__me',
      name: (me && me.name) || 'Вы',
      stream: media.screen ? myStreams.screen : (media.cam ? myStreams.cam : null),
      screen: !!media.screen,
      self: true,
      hand: !!media.hand,
      mic: !!media.mic,
      stats: null,
      connected: true,
    });
    return out;
  }, [peers, links, remoteStream, me, media, myStreams, tick]);

  const screen = entries.find((e) => e.screen);
  const pinnedEntry = pinned && entries.find((e) => e.av === pinned);
  const big = pinnedEntry || screen || (entries.length === 1 ? entries[0] : null) || null;
  const rest = entries.filter((e) => e !== big);
  const grid = layout === 'grid' || (!big && entries.length > 1);

  const renderTile = (e, tall) => (
    <Tile
      key={e.av + (e.screen ? '-s' : '')}
      av={e.av}
      name={e.name}
      stream={e.stream}
      speaking={e.self ? !!(me && me.speaking) : !!(speaking && speaking[e.av])}
      mirrored={!e.screen}
      isScreen={e.screen}
      isSelf={e.self}
      showStats={showStats}
      stats={e.stats}
      pinned={pinned === e.av}
      onPin={(av) => onPin(pinned === av ? null : av)}
      onFullscreen={(el) => {
        try {
          if (document.fullscreenElement) document.exitFullscreen();
          else if (el && el.requestFullscreen) el.requestFullscreen();
        } catch {
          /* браузер не дал */
        }
      }}
      register={register}
    />
  );

  const nobody = entries.length === 1 && !entries[0].stream;

  return (
    <section className={'stage' + (grid ? '' : ' stage--focus')} data-layout={grid ? 'grid' : 'focus'}>
      {recording && recording.active ? (
        <div className="sharebar" style={{ background: 'var(--red)' }}>
          <Icon name="sparkles" size={16} />
          <b>Идёт запись</b>
          <span>{Math.floor(recording.ms / 60000)}:{String(Math.floor(recording.ms / 1000) % 60).padStart(2, '0')} · {Math.round(recording.bytes / 1024)} КБ</span>
          <span className="grow" />
          <button className="btn btn--sm" onClick={() => onStartRecord(true)}>Остановить и скачать</button>
        </div>
      ) : null}

      {media.screen ? (
        <div className="sharebar">
          <Icon name="screen" size={16} />
          <b>Вы показываете экран</b>
          <span className="hide-sm">
            {screenTuning
              ? (QUALITY[screenTuning.quality] ? QUALITY[screenTuning.quality].label : screenTuning.quality + 'p')
                + ' · ' + screenTuning.fps + ' кадр/с'
              : 'друзья видят его вместо камеры'}
          </span>
          <span className="grow" />
          {onScreenTuning ? (
            <QualityPopover
              kind="screen"
              value={screenTuning || {}}
              onChange={onScreenTuning}
              label="Качество"
            />
          ) : null}
          <button className="btn btn--sm" onClick={onStopShare}>Остановить</button>
        </div>
      ) : null}

      {peers.some((p) => p.hand) ? (
        <div className="stage__note">
          <Icon name="hand" size={16} />
          Подняли руку: {peers.filter((p) => p.hand).map((p) => p.name).join(', ')}
        </div>
      ) : null}

      {nobody ? (
        <div className="stage__empty">
          <Icon name="users" size={40} />
          <h3>Пока только вы</h3>
          <p>
            Отправьте друзьям ссылку-приглашение — они попадут в эту комнату сразу, без регистрации.
            Звук и видео пойдут напрямую между браузерами.
          </p>
          {!media.cam ? (
            <button className="btn btn--brand" onClick={onTurnOnCam}>
              <Icon name="video" size={18} /> Включить камеру
            </button>
          ) : null}
          {relayStatus && !relayStatus.ok && relayStatus.error ? (
            <p className="hint">Релей знакомства молчит: {relayStatus.error}. Друзья вас не увидят, пока он не поднимется.</p>
          ) : null}
        </div>
      ) : null}

      {!nobody && grid ? (
        <div className="tiles">{entries.map((e) => renderTile(e, false))}</div>
      ) : null}

      {!nobody && !grid ? (
        <div className="stage__focus">
          {big ? renderTile(big, true) : null}
          {rest.length ? <div className="tiles">{rest.map((e) => renderTile(e, false))}</div> : null}
        </div>
      ) : null}

      <div className="row" style={{ gap: 6 }}>
        <button className={'iconbtn ' + (layout === 'focus' ? 'is-on' : '')} onClick={() => onLayout('focus')} title="Крупно">
          <Icon name="pin" size={17} />
        </button>
        <button className={'iconbtn ' + (layout === 'grid' ? 'is-on' : '')} onClick={() => onLayout('grid')} title="Сетка">
          <Icon name="grid" size={17} />
        </button>
        {pinned ? (
          <button className="chip" onClick={() => onPin(null)} title="Снять закрепление">
            <Icon name="x" size={12} /> закреплено
          </button>
        ) : null}
        <span className="grow" />
      </div>
    </section>
  );
}
