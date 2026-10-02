'use client';

import { Icon } from './Icon.jsx';
import { Avatar } from './Avatar.jsx';
import { fmtBitrate } from '@/lib/util.js';

function Member({ name, av, mic, cam, hand, screen, speaking, link, self, conn }) {
  const dot = conn === 'connected' || conn === 'dc' ? 'ok' : conn === 'failed' ? 'busy' : '';
  return (
    <div className={'member' + (speaking ? ' is-speaking' : '') + (self ? ' member--me' : '')} title={name}>
      <span className="member__ava">
        <Avatar name={name} size="sm" speaking={speaking} />
        <span className={'dot ' + (dot ? 'dot--' + dot : '')} />
      </span>
      <span className="member__name">{name}{self ? ' (вы)' : ''}</span>
      <span className="member__meta">
        {screen ? <Icon name="screen" size={14} /> : null}
        {hand ? <Icon name="hand" size={14} /> : null}
        {cam ? <Icon name="video" size={14} /> : null}
        <Icon name={mic ? 'mic' : 'micOff'} size={14} />
      </span>
    </div>
  );
}

/** Список участников: кто в звонке, кто только в комнате, и как идёт связь. */
export function Members({ me, media, peers, links, speaking, onClose, showStats, relayStatus }) {
  const inCall = peers.filter((p) => {
    const l = (links && links[p.av]) || {};
    return l.dcOpen || l.connection === 'connected' || l.connection === 'connecting';
  });
  const watching = peers.filter((p) => !inCall.includes(p));

  return (
    <aside className="members">
      <div className="members__head">
        <span>Участники — {(peers ? peers.length : 0) + 1}</span>
        <span className="grow" />
        <button className="iconbtn" onClick={onClose} title="Скрыть список" aria-label="Скрыть список">
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className="members__group">
        <div className="members__gname">Голосовой канал — {inCall.length + 1}</div>
        <Member
          name={me.name || 'Вы'}
          av={me.av}
          mic={media.mic}
          cam={media.cam}
          hand={media.hand}
          screen={media.screen}
          speaking={!!me.speaking}
          conn="dc"
          self
        />
        {me.av && links && links[me.av] ? (
          <div className="tagline">
            {links[me.av].rtt ? <span>{Math.round(links[me.av].rtt)} мс</span> : null}
            {links[me.av].candidateType ? <span>{links[me.av].candidateType === 'relay' ? 'через TURN' : 'напрямую'}</span> : null}
            {media.mode === 'blocked' ? <span>нет доступа к устройствам</span> : null}
          </div>
        ) : null}

        {inCall.map((p) => {
          const l = (links && links[p.av]) || {};
          return (
            <div key={p.av}>
              <Member
                name={p.name}
                av={p.av}
                mic={p.mic}
                cam={p.cam}
                hand={p.hand}
                screen={p.screen}
                speaking={!!(speaking && speaking[p.av])}
                link={l}
                conn={l.dcOpen ? 'dc' : l.connection}
              />
              <div className="tagline">
                {l.dcOpen ? <span className="state state--ok"><Icon name="zap" size={11} /> прямой канал</span> : <span className="state state--wait">соединяемся…</span>}
                {l.rtt ? <span>{Math.round(l.rtt)} мс</span> : null}
                {l.outBps ? <span>{fmtBitrate(l.outBps)} отдаём</span> : null}
                {l.lost ? <span>потери {l.lost}</span> : null}
              </div>
            </div>
          );
        })}
      </div>

      {watching.length ? (
        <div className="members__group">
          <div className="members__gname">В комнате без звонка — {watching.length}</div>
          {watching.map((p) => (
            <Member key={p.av} name={p.name} av={p.av} mic={p.mic} cam={p.cam} hand={p.hand} speaking={false} conn="idle" />
          ))}
        </div>
      ) : null}

      <div className="members__group">
        <div className="members__gname">Связь</div>
        <div className="tagline" style={{ paddingLeft: 8 }}>
          <span className="state state--ok"><Icon name="zap" size={11} /> P2P напрямую</span>
          {relayStatus ? (
            <span className={'state ' + (relayStatus.ok ? 'state--ok' : 'state--warn')}>
              <Icon name="globe" size={11} /> релей: {relayStatus.mode === 'ws' ? 'свой' : relayStatus.mode === 'sse' ? 'публичный' : 'нет'}
            </span>
          ) : null}
        </div>
        <p className="hint" style={{ padding: '4px 8px' }}>
          Релей передаёт только зашифрованное знакомство. Звук, видео, чат и доска идут между браузерами.
        </p>
      </div>
    </aside>
  );
}
