'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon.jsx';
import { renderBoard, BOARD_COLORS, BOARD_WIDTHS } from '@/core/board.js';

/**
 * Доска: общая для всех в комнате. Штрихи летят по прямому каналу,
 * картинка рисуется на канвасе — одинаково у всех.
 */
export function Board({ store, rev, board, onClose, onUndo, onClear, me }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [color, setColor] = useState(BOARD_COLORS[1]);
  const [width, setWidth] = useState(BOARD_WIDTHS[1]);
  const [localOnly, setLocalOnly] = useState(false);
  const dragRef = useRef({ sid: null, last: null, queue: [] });
  const sizeRef = useRef({ w: 0, h: 0 });

  /* размер канваса под контейнер (с учётом плотности пикселей) */
  useEffect(() => {
    const resize = () => {
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = wrap.clientWidth - 24;
      const h = wrap.clientHeight - 24;
      canvas.width = Math.max(320, Math.floor(w * dpr));
      canvas.height = Math.max(240, Math.floor(h * dpr));
      canvas.style.width = Math.max(320, w) + 'px';
      canvas.style.height = Math.max(240, h) + 'px';
      sizeRef.current = { w: canvas.width, h: canvas.height };
      redraw();
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas || !store) return;
    const ctx = canvas.getContext('2d');
    renderBoard(ctx, store.strokes, { width: canvas.width, height: canvas.height });
  };

  useEffect(() => {
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev, store]);

  const pointFromEvent = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    return [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))];
  };

  const onDown = (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const [x, y] = pointFromEvent(e);
    if (localOnly) {
      /* тихие пометки только у себя */
      const sid = 'local-' + Math.random().toString(36).slice(2, 9);
      store.apply({ t: 'pt', sid, color, w: width, a: (me && me.av) || 'me', pts: [[x, y]] });
      dragRef.current = { sid, last: [x, y], local: true, queue: [] };
      redraw();
      return;
    }
    const sid = board.start(x, y, color, width);
    dragRef.current = { sid, last: [x, y], local: false, queue: [] };
  };

  const onMove = (e) => {
    const drag = dragRef.current;
    if (!drag || !drag.sid) return;
    if (!drag.queue) drag.queue = [];
    const [x, y] = pointFromEvent(e);
    const last = drag.last || [x, y];
    const dist = Math.hypot(x - last[0], y - last[1]);
    if (dist < 0.0025) return;
    /* прореживаем точки: между ними всё равно прямая */
    drag.queue.push([x, y]);
    drag.last = [x, y];
    if (drag.queue.length >= 4 || dist > 0.03) {
      const pts = drag.queue.splice(0);
      if (drag.local) {
        store.apply({ t: 'pt', sid: drag.sid, color, w: width, a: (me && me.av) || 'me', pts });
        redraw();
      } else {
        board.move(drag.sid, pts, color, width);
      }
    }
    if (drag.local && drag.queue.length) {
      store.apply({ t: 'pt', sid: drag.sid, color, w: width, a: (me && me.av) || 'me', pts: drag.queue.splice(0) });
      redraw();
    }
  };

  const onUp = () => {
    const drag = dragRef.current;
    if (!drag || !drag.sid) return;
    if (!drag.queue) drag.queue = [];
    if (drag.queue.length) {
      if (drag.local) store.apply({ t: 'pt', sid: drag.sid, color, w: width, pts: drag.queue.splice(0) });
      else board.move(drag.sid, drag.queue.splice(0), color, width);
    }
    if (!drag.local) board.end(drag.sid);
    dragRef.current = { sid: null, last: null, queue: [] };
    redraw();
  };

  const points = store ? store.points : 0;

  return (
    <div className="board">
      <div className="board__top">
        <Icon name="board" size={20} />
        <h3>Общая доска</h3>
        <span className="hint">{store ? store.size : 0} штрихов · {points} точек</span>
        <span className="grow" />
        <label className="switch" title="Тихие пометки: их увидят только у вас">
          <input type="checkbox" checked={localOnly} onChange={(e) => setLocalOnly(e.target.checked)} />
          <span className="hint">только у себя</span>
        </label>
        <button className="iconbtn" onClick={onClose} aria-label="Закрыть доску" title="Закрыть (Esc)">
          <Icon name="x" size={22} />
        </button>
      </div>

      <div className="board__tools">
        <div className="board__colors">
          {BOARD_COLORS.map((c) => (
            <button
              key={c}
              className={'swatch' + (c === color ? ' is-on' : '')}
              style={{ background: c, boxShadow: c === '#ffffff' ? 'inset 0 0 0 1px #555' : undefined }}
              onClick={() => setColor(c)}
              aria-label={'Цвет ' + c}
            />
          ))}
        </div>
        <span style={{ width: 1, height: 20, background: 'var(--stroke)' }} />
        <div className="board__widths">
          {BOARD_WIDTHS.map((w) => (
            <button key={w} className={'wbtn' + (w === width ? ' is-on' : '')} onClick={() => setWidth(w)} aria-label={'Толщина ' + w}>
              <i style={{ height: Math.max(2, w / 1.6) }} />
            </button>
          ))}
        </div>
        <span className="grow" />
        <button className="btn btn--sm btn--ghost" onClick={onUndo} title="Отменить последний штрих">
          <Icon name="undo" size={16} /> Отменить
        </button>
        <button className="btn btn--sm btn--ghost" onClick={onClear} title="Стереть всё">
          <Icon name="trash" size={16} /> Очистить
        </button>
      </div>

      <div ref={wrapRef} style={{ flex: 1, minHeight: 0, display: 'flex', justifyContent: 'center' }}>
        <canvas
          ref={canvasRef}
          className="board__canvas"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={onUp}
        />
      </div>
    </div>
  );
}
