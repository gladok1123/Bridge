'use client';

import { Icon } from './Icon.jsx';
import { Avatar } from './Avatar.jsx';
import { fmtBitrate } from '@/lib/util.js';

/** Полоса голоса: состояние связи, кнопки управления и участники. */
export function VoicePanel({
  room, counts, media, me, peers, links, speaking,
  onToggleMic, onToggleCam, onShareScreen, onToggleHand, onBoard, onRecord, recording,
  onMembers, onLeave, onInvite, relayStatus,
}) {
  const inRoom = peers || [];
  const micBlocked = media.mode === 'blocked';
  const ping = links && Object.values(links).find((l) => l && typeof l.rtt === 'number' && l.rtt > 0);
  const relayTone = relayStatus && relayStatus.ok ? 'ok' : relayStatus && relayStatus.error ? 'warn' : '';

  return (
    <div className="voicepanel">
      <div className="voicepanel__card">
        <div className="voicepanel__top">
          <div className="voicepanel__state">
            <div className="voicepanel__title">
              <span className="dot-live" />
              Голос подключён
            </div>
            <div className="voicepanel__sub" title={relayStatus && relayStatus.base ? 'релей: ' + relayStatus.base : ''}>
              {room.code} · {counts.total} чел.
              {relayStatus && relayStatus.mode === 'ws' ? ' · свой релей' : ''}
              {relayStatus && relayStatus.mode === 'sse' && relayStatus.ok ? ' · напрямую' : ''}
            </div>
          </div>
          <span className={'chip ' + (relayTone === 'ok' ? 'chip--ok' : relayTone === 'warn' ? 'chip--warn' : '')} title="Задержка связи">
            <Icon name="signal" size={14} />
            {ping ? Math.round(ping.rtt) + ' мс' : '—'}
          </span>
          <button className="iconbtn" onClick={onInvite} title="Позвать друзей" aria-label="Позвать">
            <Icon name="users" size={18} />
          </button>
        </div>

        {inRoom.length ? (
          <div className="voicepanel__people">
            {inRoom.slice(0, 6).map((p) => (
              <span className="voicepanel__person" key={p.av}>
                <Avatar name={p.name} size="sm" speaking={!!(speaking && speaking[p.av])} />
                <span className="n">{p.name}</span>
                {p.hand ? <Icon name="hand" size={13} /> : null}
                {!p.mic ? <Icon name="micOff" size={13} /> : null}
              </span>
            ))}
            {inRoom.length > 6 ? <span className="voicepanel__person">+{inRoom.length - 6}</span> : null}
          </div>
        ) : null}
      </div>

      <div className={'voicebar' + (inRoom.length ? '' : ' voicebar--solo')}>
        <button
          className={'vbtn ' + (media.mic ? 'is-on' : 'is-off')}
          onClick={onToggleMic}
          title={media.mic ? 'Микрофон включён (M)' : micBlocked ? 'Микрофон недоступен: ' + media.error : 'Микрофон выключен (M)'}
          aria-label="Микрофон"
        >
          <Icon name={media.mic ? 'mic' : 'micOff'} size={18} />
          {!media.mic ? <span className="vbtn__dot" /> : null}
        </button>
        <button
          className={'vbtn ' + (media.cam ? 'is-on' : '')}
          onClick={onToggleCam}
          title="Камера (V)"
          aria-label="Камера"
        >
          <Icon name={media.cam ? 'video' : 'videoOff'} size={18} />
        </button>
        <button
          className={'vbtn ' + (media.screen ? 'is-on' : '')}
          onClick={onShareScreen}
          title="Показать экран (S)"
          aria-label="Показать экран"
        >
          <Icon name={media.screen ? 'screen' : 'screenOff'} size={18} />
        </button>
        <button
          className={'vbtn ' + (media.hand ? 'is-on' : '')}
          onClick={onToggleHand}
          title="Поднять руку (H)"
          aria-label="Поднять руку"
        >
          <Icon name="hand" size={18} />
        </button>
        <button className="vbtn" onClick={onBoard} title="Доска (B)" aria-label="Доска">
          <Icon name="board" size={18} />
        </button>
        <button
          className={'vbtn ' + (recording && recording.active ? 'is-on' : '')}
          onClick={onRecord}
          title="Запись (R)"
          aria-label="Запись"
        >
          <Icon name="sparkles" size={18} />
        </button>
        <span className="grow" />
        <button
          className="vbtn"
          onClick={onLeave}
          title="Выйти из звонка"
          aria-label="Выйти"
          style={{ color: 'var(--red)' }}
        >
          <Icon name="phoneOff" size={18} />
        </button>
      </div>
    </div>
  );
}

/** Нижняя панель пользователя: имя, микрофон, звук, настройки. */
export function MeBar({ me, media, onToggleMic, onSettings, sound, onSound, onToggleMembers, membersOpen }) {
  return (
    <div className="voicebar" style={{ background: '#232428' }}>
      <button className="row" onClick={onSettings} title="Настройки профиля" style={{ gap: 8, padding: '2px 4px', borderRadius: 6 }}>
        <Avatar name={me.name} size="sm" speaking={me.speaking} />
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
          <span style={{ fontSize: 13, fontWeight: 600, maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {me.name || 'Гость'}
          </span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{media.mic ? 'микрофон включён' : 'без микрофона'}</span>
        </span>
      </button>
      <span className="grow" />
      <button
        className={'vbtn ' + (media.mic ? '' : 'is-off')}
        onClick={onToggleMic}
        title={media.mic ? 'Выключить микрофон (M)' : 'Включить микрофон (M)'}
        aria-label="Микрофон"
      >
        <Icon name={media.mic ? 'mic' : 'micOff'} size={17} />
      </button>
      <button className={'vbtn ' + (sound ? 'is-off' : '')} onClick={onSound} title="Звуки интерфейса" aria-label="Звуки">
        <Icon name={sound ? 'volumeOff' : 'volume'} size={17} />
      </button>
      <button className={'vbtn ' + (membersOpen ? 'is-on' : '')} onClick={onToggleMembers} title="Участники (U)" aria-label="Участники">
        <Icon name="users" size={17} />
      </button>
    </div>
  );
}
