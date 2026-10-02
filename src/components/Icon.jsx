'use client';

import { ICONS } from '@/lib/icons.js';

/** Иконка Bridge: вектор, без картинок и без внешних шрифтов. */
export function Icon({ name, size = 20, className = '', strokeWidth = 1.7, title }) {
  const d = ICONS[name] || ICONS.info;
  return (
    <svg
      className={'i ' + className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      <path d={d} />
    </svg>
  );
}
