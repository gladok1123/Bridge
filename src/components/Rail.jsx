'use client';

import { Icon } from './Icon.jsx';
import { Avatar } from './Avatar.jsx';

/**
 * Узкая полоса слева («рельса» в духе Discord):
 * главная, быстрые комнаты из истории и кнопка «создать».
 */
export function Rail({ phase, room, history, onHome, onJoin, onNew, onSettings, onHelp, me }) {
  const rooms = (history || []).slice(0, 6);
  return (
    <nav className="rail" aria-label="Разделы">
      <button
        className={'rail__btn rail__btn--home' + (phase === 'home' ? ' is-active' : '')}
        onClick={onHome}
        title="Главная"
        aria-label="Главная"
      >
        <span className="rail__pill" />
        <Icon name="logo" size={26} />
      </button>

      <span className="rail__sep" />

      {rooms.map((r) => (
        <button
          key={r.code}
          className={'rail__btn' + (phase === 'room' && room.code === r.code ? ' is-active' : '')}
          onClick={() => onJoin(r.code, r.secret)}
          title={'Комната «' + r.code + '»'}
          aria-label={'Комната ' + r.code}
        >
          <span className="rail__pill" />
          <span className="rail__letter">{String(r.code).slice(0, 2).toUpperCase()}</span>
        </button>
      ))}

      <button className="rail__btn rail__btn--add" onClick={onNew} title="Новая комната" aria-label="Новая комната">
        <Icon name="plus" size={24} />
      </button>

      <span className="rail__spacer" />

      <button className="rail__btn rail__btn--sm" onClick={onSettings} title="Настройки" aria-label="Настройки">
        <Icon name="gear" size={22} />
      </button>
      <button className="rail__btn rail__btn--sm" onClick={onHelp} title="Как это работает" aria-label="Помощь">
        <Icon name="help" size={22} />
      </button>
      <span className="rail__sep" />
      <div className="center" title={me && me.name ? me.name : 'Гость'}>
        <Avatar name={me && me.name} size="sm" />
      </div>
    </nav>
  );
}
