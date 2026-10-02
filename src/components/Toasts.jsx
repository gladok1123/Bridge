'use client';

import { Icon } from './Icon.jsx';

/** Всплывающие подсказки: не мешают, но всё важное видно. */
export function Toasts({ items, onClose }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={'toast toast--' + (t.tone || 'info')}>
          <div className="toast__body">
            <div className="toast__title">{t.title}</div>
            {t.text ? <div className="toast__text">{t.text}</div> : null}
          </div>
          <button className="toast__x" onClick={() => onClose(t.id)} aria-label="Закрыть">
            <Icon name="x" size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
