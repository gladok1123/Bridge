'use client';

import { useEffect } from 'react';
import { Icon } from './Icon.jsx';

/** Окно: закрывается по Esc и по клику снаружи. */
export function Modal({ title, icon = 'gear', children, footer, onClose, wide = false, tabs = null }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'modal' + (wide ? ' modal--wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal__head">
          <Icon name={icon} size={20} />
          <h3>{title}</h3>
          <button className="iconbtn" onClick={onClose} aria-label="Закрыть">
            <Icon name="x" size={18} />
          </button>
        </div>
        {tabs}
        <div className="modal__body">{children}</div>
        {footer ? <div className="modal__foot">{footer}</div> : null}
      </div>
    </div>
  );
}
