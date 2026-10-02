'use client';

import { useState } from 'react';
import { Icon } from './Icon.jsx';
import {
  QUALITY, FPS_CHOICES, BITRATE_CHOICES, HINT_CHOICES,
  autoBitrate, preferredBitrate,
} from '@/core/media.js';
import { fmtBitrate } from '@/lib/util.js';

/**
 * Выбор качества потока — как в Discord: разрешение, кадры, предел битрейта
 * и оптимизация под текст или движение. Один и тот же блок используется
 * и в настройках, и на плашке показа экрана (там он применяется сразу).
 */
export function QualityPicker({ kind = 'cam', value = {}, onChange, compact = false }) {
  const quality = Number(value.quality) || (kind === 'screen' ? 1080 : 720);
  const fps = Number(value.fps) || 30;
  const bitrate = Number(value.bitrate) || 0;
  const hint = value.hint || 'auto';

  const auto = autoBitrate({ quality, fps, kind, hint });
  const effective = preferredBitrate({ bitrate, quality, fps, kind, hint });
  const patch = (p) => onChange && onChange(p);

  const resolutionRow = (
    <div className="picker__row">
      <span className="picker__label">Разрешение</span>
      <div className="picker__picks">
        {Object.entries(QUALITY).map(([key, q]) => (
          <button
            key={key}
            className={'pick' + (String(quality) === key ? ' is-on' : '')}
            onClick={() => patch({ quality: key })}
            title={q.w + '×' + q.h}
          >
            {q.label}
          </button>
        ))}
      </div>
    </div>
  );

  const fpsRow = (
    <div className="picker__row">
      <span className="picker__label">Кадры в секунду</span>
      <div className="picker__picks">
        {FPS_CHOICES.map((f) => (
          <button
            key={f}
            className={'pick' + (String(fps) === String(f) ? ' is-on' : '')}
            onClick={() => patch({ fps: String(f) })}
          >
            {f}
          </button>
        ))}
      </div>
    </div>
  );

  const bitrateRow = (
    <div className="picker__row">
      <span className="picker__label">Предел битрейта</span>
      <div className="picker__picks">
        {BITRATE_CHOICES.map((b) => (
          <button
            key={b.value}
            className={'pick' + (String(bitrate) === String(b.value) ? ' is-on' : '')}
            onClick={() => patch({ bitrate: b.value })}
          >
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );

  const hintRow = kind === 'screen' ? (
    <div className="picker__row">
      <span className="picker__label">Оптимизация</span>
      <div className="picker__picks">
        {HINT_CHOICES.map((h) => (
          <button
            key={h.value}
            className={'pick' + (hint === h.value ? ' is-on' : '')}
            onClick={() => patch({ hint: h.value })}
          >
            {h.label}
          </button>
        ))}
      </div>
    </div>
  ) : null;

  return (
    <div className={'picker' + (compact ? ' picker--compact' : '')}>
      {resolutionRow}
      {fpsRow}
      {bitrateRow}
      {hintRow}
      <p className="picker__note">
        <Icon name="info" size={13} />
        Идёт около <b>{fmtBitrate(effective)}</b>
        {bitrate > 0 ? ' (предел выставлен вручную)' : ' (посчитано автоматически: ' + fmtBitrate(auto) + ')'}
        {' '}· {QUALITY[quality] ? QUALITY[quality].label : quality + 'p'} · {fps} кадр/с.
        {kind === 'screen'
          ? ' Для презентаций и кода выбирайте «Резко», для видео — «Плавно».'
          : ' Чем выше — тем чётче картинка и больше нагрузка на сеть.'}
      </p>
    </div>
  );
}

/** Раскрывающийся блок качества для плашки показа экрана. */
export function QualityPopover({ kind = 'screen', value, onChange, label }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="popover-wrap">
      <button className="btn btn--sm" onClick={() => setOpen((v) => !v)} title="Качество потока">
        <Icon name="screen" size={14} /> {label || 'Качество'}
        <Icon name={open ? 'chevron' : 'chevronRight'} size={13} />
      </button>
      {open ? (
        <>
          <span className="popover__veil" onClick={() => setOpen(false)} />
          <div className="popover">
            <div className="popover__head">
              <b>{kind === 'screen' ? 'Качество показа экрана' : 'Качество камеры'}</b>
              <button className="iconbtn" onClick={() => setOpen(false)} aria-label="Закрыть">
                <Icon name="x" size={16} />
              </button>
            </div>
            <QualityPicker kind={kind} value={value} onChange={onChange} compact />
            <p className="hint" style={{ margin: 0 }}>
              Меняется сразу, без перезапуска показа.
            </p>
          </div>
        </>
      ) : null}
    </span>
  );
}
