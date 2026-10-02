'use client';

import { avatarStyle, firstLetter } from '@/lib/util.js';
import { Icon } from './Icon.jsx';

/** Кружок с буквой: цвет всегда один и тот же для одного и того же имени. */
export function Avatar({ name, size = 'md', speaking = false, muted = false, className = '' }) {
  const cls = ['avatar', size === 'sm' ? 'avatar--sm' : size === 'lg' ? 'avatar--lg' : size === 'xl' ? 'avatar--xl' : '', speaking ? 'avatar--ring' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={cls} style={avatarStyle(name)} title={name || 'Гость'}>
      {firstLetter(name)}
    </span>
  );
}

export function MicState({ mic, size = 14, blocked = false }) {
  if (blocked) return <Icon name="alert" size={size} />;
  return <Icon name={mic ? 'mic' : 'micOff'} size={size} />;
}
