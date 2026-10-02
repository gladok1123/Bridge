'use client';

import { useState } from 'react';
import { Icon } from './Icon.jsx';
import { Avatar } from './Avatar.jsx';
import { VoicePanel, MeBar } from './VoicePanel.jsx';

function whenText(ts) {
  if (!ts) return 'давно';
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60) return 'только что';
  if (d < 3600) return Math.floor(d / 60) + ' мин назад';
  if (d < 86400) return Math.floor(d / 3600) + ' ч назад';
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

/** Колонка каналов: свои комнаты, полоса голоса и панель пользователя. */
export function Sidebar({
  phase, room, history, counts, peers, me, media, links, speaking, relayStatus,
  onHome, onJoin, onNew, onForget, onRename, onSettings, sound, onSound,
  onToggleMic, onToggleMembers, membersOpen, recording,
  onToggleCam, onShareScreen, onToggleHand, onBoard, onRecord, onLeave, onInvite, onHelp,
}) {
  const [roomsOpen, setRoomsOpen] = useState(true);

  return (
    <aside className="side">
      <div className="side__head" onClick={phase === 'room' ? onRename : onHome} title={phase === 'room' ? 'Переименовать себя или позвать' : 'Bridge'}>
        <h1 className="side__title">
          <Icon name={phase === 'room' ? 'hash' : 'logo'} size={18} />
          {phase === 'room' ? room.code : 'Bridge — звонки'}
        </h1>
        <Icon name="chevron" size={16} />
      </div>

      <div className="side__scroll">
        <div className="side__group" data-open={roomsOpen ? '1' : '0'}>
          <div className="side__ghead" onClick={() => setRoomsOpen((v) => !v)}>
            <Icon name="chevron" size={12} className="side__chev" />
            <span>Голосовые комнаты</span>
            <button
              className="iconbtn"
              style={{ width: 20, height: 20 }}
              onClick={(e) => { e.stopPropagation(); onNew(); }}
              title="Новая комната"
              aria-label="Новая комната"
            >
              <Icon name="plus" size={14} />
            </button>
          </div>
          <div className="side__rows">
            {history.length === 0 ? (
              <p className="hint" style={{ padding: '4px 8px' }}>
                Здесь появятся ваши комнаты. Нажмите «+», чтобы создать первую.
              </p>
            ) : null}
            {history.map((r) => {
              const active = phase === 'room' && room.code === r.code;
              return (
                <div key={r.code} className={'chan' + (active ? ' is-active' : '')}>
                  <button
                    className="chan__name row"
                    style={{ gap: 6, background: 'none', border: 0, padding: 0, color: 'inherit' }}
                    onClick={() => onJoin(r.code, r.secret)}
                  >
                    <Icon name="volume" size={16} />
                    <span className="chan__name">{r.code}</span>
                  </button>
                  {active ? (
                    <span className="chan__badge">{counts.total}</span>
                  ) : (
                    <span className="hint" style={{ fontSize: 11 }}>{whenText(r.at)}</span>
                  )}
                  <button
                    className="chan__del"
                    onClick={() => onForget(r.code)}
                    title="Убрать из списка"
                    aria-label="Убрать комнату"
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="side__group">
          <div className="side__ghead">
            <Icon name="zap" size={12} />
            <span>Как это работает</span>
          </div>
          <ul className="hint" style={{ listStyle: 'none', margin: 0, padding: '0 8px', display: 'grid', gap: 8 }}>
            <li className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
              <Icon name="zap" size={14} /> Прямое соединение P2P: звук и видео идут между браузерами
            </li>
            <li className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
              <Icon name="shield" size={14} /> Сигналинг зашифрован, релей видит только шифр
            </li>
            <li className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
              <Icon name="globe" size={14} /> Ссылка-приглашение несёт ключ комнаты — пересылайте только своим
            </li>
          </ul>
        </div>
      </div>

      {phase === 'room' ? (
        <div className="side__foot">
          <VoicePanel
            room={room}
            counts={counts}
            media={media}
            me={me}
            peers={peers}
            links={links}
            speaking={speaking}
            relayStatus={relayStatus}
            recording={recording}
            onToggleMic={onToggleMic}
            onToggleCam={onToggleCam}
            onShareScreen={onShareScreen}
            onToggleHand={onToggleHand}
            onBoard={onBoard}
            onRecord={onRecord}
            onMembers={onToggleMembers}
            onLeave={onLeave}
            onInvite={onInvite}
          />
          <MeBar
            me={me}
            media={media}
            sound={sound}
            onSound={onSound}
            onSettings={onSettings}
            onToggleMic={onToggleMic}
            onToggleMembers={onToggleMembers}
            membersOpen={membersOpen}
          />
        </div>
      ) : (
        <div className="side__foot">
          <MeBar
            me={me}
            media={media}
            sound={sound}
            onSound={onSound}
            onSettings={onSettings}
            onToggleMic={onToggleMic}
            onToggleMembers={onToggleMembers}
            membersOpen={membersOpen}
          />
        </div>
      )}
    </aside>
  );
}
