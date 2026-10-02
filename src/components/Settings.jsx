'use client';

import { useState } from 'react';
import { Icon } from './Icon.jsx';
import { Modal } from './Modal.jsx';
import { Avatar } from './Avatar.jsx';
import { ENV } from '@/lib/config.js';
import { QualityPicker } from './QualityPicker.jsx';

const TABS = [
  { id: 'profile', name: 'Профиль', icon: 'user' },
  { id: 'av', name: 'Звук и видео', icon: 'mic' },
  { id: 'net', name: 'Сеть', icon: 'globe' },
  { id: 'check', name: 'Проверка', icon: 'shield' },
];

function Switch({ checked, onChange, label, hint }) {
  return (
    <label className="row spread" style={{ gap: 12, padding: '8px 0', cursor: 'pointer' }}>
      <span>
        <b style={{ fontSize: 14 }}>{label}</b>
        {hint ? <div className="hint">{hint}</div> : null}
      </span>
      <span className="switch">
        <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      </span>
    </label>
  );
}

/** Настройки: профиль, устройства, сеть и проверка связи. */
export function Settings({ settings, update, me, media, diag, onDiag, tone, onClose, onRename }) {
  const [tab, setTab] = useState('profile');
  const [name, setName] = useState(settings.name || '');
  const [turn, setTurn] = useState(settings.turn || '');
  const [stun, setStun] = useState(settings.stun || ENV.stun);
  const [relay, setRelay] = useState(settings.relay || '');

  const save = () => {
    update({ name: name.trim(), turn: turn.trim(), stun: stun.trim(), relay: relay.trim() });
    if (name.trim() && onRename) onRename(name.trim());
  };

  const rowsByTab = {
    check: diag.rows,
  };

  return (
    <Modal
      title="Настройки"
      icon="gear"
      onClose={onClose}
      wide
      tabs={(
        <div className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={'tab' + (tab === t.id ? ' is-on' : '')} onClick={() => setTab(t.id)}>
              <Icon name={t.icon} size={15} /> {t.name}
            </button>
          ))}
        </div>
      )}
      footer={(
        <>
          <button className="btn btn--ghost" onClick={onClose}>Закрыть</button>
          <button className="btn btn--brand" onClick={() => { save(); onClose(); }}>Сохранить</button>
        </>
      )}
    >
      {tab === 'profile' ? (
        <>
          <div className="row" style={{ gap: 14, marginBottom: 18 }}>
            <Avatar name={name || me.name} size="xl" />
            <div>
              <b style={{ fontSize: 16 }}>{name || me.name || 'Гость'}</b>
              <div className="hint">Цвет кружка подбирается по имени — у друзей будет такой же.</div>
            </div>
          </div>
          <div className="field">
            <label>Ваше имя</label>
            <input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Как вас называть в звонке" />
            <small>Имя видят только те, кто в комнате. Никакой регистрации нет.</small>
          </div>
          <div className="field">
            <label>Хранить звуки</label>
            <Switch
              checked={settings.soundOff}
              onChange={(v) => update({ soundOff: v })}
              label="Выключить звуки интерфейса"
              hint="Вход и выход участников, сообщения, поднятая рука"
            />
          </div>
        </>
      ) : null}

      {tab === 'av' ? (
        <>
          <div className="field">
            <label><Icon name="video" size={13} /> Камера</label>
            <QualityPicker
              kind="cam"
              value={{ quality: settings.camQuality, fps: settings.camFps, bitrate: settings.camBitrate }}
              onChange={(p) => update({
                camQuality: p.quality !== undefined ? p.quality : settings.camQuality,
                camFps: p.fps !== undefined ? p.fps : settings.camFps,
                camBitrate: p.bitrate !== undefined ? p.bitrate : settings.camBitrate,
              })}
            />
          </div>

          <div className="field">
            <label><Icon name="screen" size={13} /> Демонстрация экрана</label>
            <QualityPicker
              kind="screen"
              value={{ quality: settings.screenQuality, fps: settings.screenFps, bitrate: settings.screenBitrate, hint: settings.streamHint }}
              onChange={(p) => update({
                screenQuality: p.quality !== undefined ? p.quality : settings.screenQuality,
                screenFps: p.fps !== undefined ? p.fps : settings.screenFps,
                screenBitrate: p.bitrate !== undefined ? p.bitrate : settings.screenBitrate,
                streamHint: p.hint !== undefined ? p.hint : settings.streamHint,
              })}
            />
            <small>
              Экран можно отдавать вплоть до 4K и 60 кадров в секунду. Если монитор меньше,
              отдаётся как есть — картинку мы не растягиваем.
            </small>
          </div>

          <div className="field">
            <Switch checked={settings.mic} onChange={(v) => update({ mic: v })} label="Включать микрофон при входе" hint="Если браузер спросит доступ — разрешите его" />
            <Switch checked={settings.cam} onChange={(v) => update({ cam: v })} label="Включать камеру при входе" />
            <Switch checked={settings.noiseSuppress} onChange={(v) => update({ noiseSuppress: v })} label="Шумоподавление" />
            <Switch checked={settings.echoCancel} onChange={(v) => update({ echoCancel: v })} label="Эхоподавление" />
            <Switch checked={settings.autoGain} onChange={(v) => update({ autoGain: v })} label="Автоматическая громкость микрофона" />
            <Switch checked={settings.shareAudio} onChange={(v) => update({ shareAudio: v })} label="Передавать звук системы при показе экрана" hint="Работает в Chrome и Edge на Windows" />
            <Switch checked={settings.showStats} onChange={(v) => update({ showStats: v })} label="Показывать замеры на плитках" hint="Задержка, битрейт и тип соединения" />
          </div>

          <p className="hint">
            Состояние сейчас: микрофон {media.mic ? 'включён' : 'выключен'}
            {media.screen ? ', идёт показ экрана' : ''}
            {media.mode === 'blocked' ? ' · доступа к устройствам нет' : ''}.
            Изменения качества применяются сразу, перезапускать звонок не нужно.
          </p>
        </>
      ) : null}

      {tab === 'net' ? (
        <>
          <div className="field">
            <label>STUN-серверы</label>
            <input className="input" value={stun} onChange={(e) => setStun(e.target.value)} placeholder="stun:stun.l.google.com:19302" />
            <small>Через них браузер узнаёт свой внешний адрес. Можно перечислить несколько через запятую.</small>
          </div>
          <div className="field">
            <label>TURN-сервер</label>
            <input className="input" value={turn} onChange={(e) => setTurn(e.target.value)} placeholder="turn:хост:3478|логин|пароль" />
            <small>
              Нужен там, где прямой путь невозможен (мобильный интернет, строгая сеть). Формат:
              <code style={{ marginLeft: 6 }}>turn:хост:3478|логин|пароль</code>
            </small>
          </div>
          <div className="field">
            <label>Свой релей знакомства</label>
            <input className="input" value={relay} onChange={(e) => setRelay(e.target.value)} placeholder="ws://192.168.1.10:8080/ws" />
            <small>
              Не обязательно. По умолчанию используется публичный релей {ENV.relayUrl}: он передаёт только
              зашифрованные кадры знакомства. Свой поднимается командой <code>npm run relay</code>.
            </small>
          </div>
          <div className="check__row" style={{ borderRadius: 8, background: 'var(--rail)' }}>
            <Icon name="info" size={18} />
            <div className="check__name">
              <b>Зачем вообще релей</b>
              <small>Он знакомит браузеры: передаёт «кто в комнате» и параметры соединения. Дальше всё идёт напрямую.</small>
            </div>
          </div>
        </>
      ) : null}

      {tab === 'check' ? (
        <>
          <div className="row spread" style={{ marginBottom: 12 }}>
            <div>
              <b>Проверка связи</b>
              <div className="hint">https, устройства, показ экрана, релей, проход через NAT</div>
            </div>
            <button className="btn btn--sm btn--brand" onClick={onDiag} disabled={diag.running}>
              <Icon name="refresh" size={16} className={diag.running ? 'spin' : ''} />
              {diag.running ? 'Проверяю…' : 'Проверить снова'}
            </button>
          </div>
          <div className="check">
            {(diag.rows || []).map((row) => {
              const t = row.state === 'ok' ? 'ok' : row.state === 'warn' ? 'warn' : row.state === 'bad' ? 'bad' : 'wait';
              return (
                <div className="check__row" key={row.id}>
                  <Icon name={t === 'ok' ? 'check' : t === 'bad' ? 'alert' : 'info'} size={17} />
                  <div className="check__name">
                    <b>{row.name}</b>
                    <small>{row.detail}</small>
                    {row.hint ? <small style={{ color: 'var(--yellow)' }}>{row.hint}</small> : null}
                  </div>
                  <span className={'state state--' + t}>
                    {t === 'ok' ? 'ок' : t === 'warn' ? 'оговорка' : t === 'bad' ? 'проблема' : '…'}
                  </span>
                </div>
              );
            })}
            {!diag.rows.length ? <div className="check__row"><div className="check__name"><b>Ещё не проверяли</b><small>Нажмите «Проверить снова»</small></div></div> : null}
          </div>
          <p className="hint" style={{ marginTop: 12 }}>
            Тот же список есть на главной странице — он же показывается при входе, если что-то мешает звуку.
          </p>
        </>
      ) : null}
    </Modal>
  );
}
