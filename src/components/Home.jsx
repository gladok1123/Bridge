'use client';

import { useEffect, useState } from 'react';
import { Icon } from './Icon.jsx';
import { Avatar } from './Avatar.jsx';
import { isSecure } from '@/core/media.js';
import { fmtDuration } from '@/lib/util.js';

const CARDS = [
  { icon: 'zap', title: 'Прямое соединение', text: 'WebRTC соединяет браузеры напрямую: звук и видео не идут через сервер.' },
  { icon: 'screen', title: 'Экран и камера', text: 'Показ экрана на всю сцену, камера плитками, переключение качества на ходу.' },
  { icon: 'board', title: 'Общая доска', text: 'Рисуйте поверх разговора: штрихи появляются у всех сразу, история — вошедшим позже.' },
  { icon: 'sparkles', title: 'Запись разговора', text: 'Сетка и звук собираются в один файл прямо в браузере — без серверов и облаков.' },
];

function CheckRow({ row }) {
  const tone = row.state === 'ok' ? 'ok' : row.state === 'warn' ? 'warn' : row.state === 'bad' ? 'bad' : 'wait';
  return (
    <div className="check__row">
      <Icon name={tone === 'ok' ? 'check' : tone === 'bad' ? 'alert' : tone === 'warn' ? 'info' : 'refresh'} size={18} className={tone === 'wait' ? 'spin' : ''} />
      <div className="check__name">
        <b>{row.name}</b>
        <small>{row.detail}</small>
        {row.hint ? <small style={{ color: 'var(--yellow)' }}>{row.hint}</small> : null}
      </div>
      <span className={'state state--' + tone}>
        {tone === 'ok' ? 'в порядке' : tone === 'warn' ? 'с оговоркой' : tone === 'bad' ? 'не работает' : 'проверяю'}
      </span>
    </div>
  );
}

/** Главная страница: заголовок, вход в комнату, проверка связи и объяснение. */
export function Home({ me, history, onJoin, onNew, onForget, onSettings, onHelp, diag, onDiag, settings, update, secure }) {
  const [input, setInput] = useState('');
  const [name, setName] = useState((settings && settings.name) || '');

  useEffect(() => {
    const t = setTimeout(() => update({ name: name.trim() }), 400);
    return () => clearTimeout(t);
  }, [name, update]);

  const submit = (e) => {
    e.preventDefault();
    const value = input.trim();
    if (value) onJoin(value);
  };

  const code = onNew;

  return (
    <div className="home">
      <div className="home__inner">
        <div className="hero">
          <span className="hero__badge">
            <Icon name="zap" size={14} /> P2P · без серверов в середине
          </span>
          <h1>Bridge — звонки, доска и чат для своих</h1>
          <p>
            Комнату создаёте вы, ссылку отправляете друзьям, а звук и видео идут напрямую между браузерами.
            Регистрация не нужна: имя можно любое.
          </p>

          <form className="hero__actions" onSubmit={submit}>
            <label className="join">
              <Icon name="hash" size={18} />
              <input
                className="join__input"
                placeholder="код комнаты или ссылка-приглашение"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                aria-label="Код комнаты"
              />
            </label>
            <button className="btn btn--brand" type="submit" disabled={!input.trim()}>
              <Icon name="arrowRight" size={18} /> Войти
            </button>
            <button className="btn btn--ghost" type="button" onClick={() => onJoin(code())}>
              <Icon name="plus" size={18} /> Создать комнату
            </button>
          </form>

          <ul className="hero__facts">
            <li><Icon name="lock" size={14} /> Сигналинг шифруется ключом из ссылки</li>
            <li><Icon name="users" size={14} /> Комфортно до 10 человек</li>
            <li><Icon name="clock" size={14} /> Комната живёт, пока в ней есть люди</li>
            {!secure ? <li style={{ color: 'var(--red)' }}><Icon name="alert" size={14} /> Открыто по http: камера и микрофон будут недоступны</li> : null}
          </ul>
        </div>

        <div className="cards">
          {CARDS.map((c) => (
            <div className="card" key={c.title}>
              <div className="card__ico"><Icon name={c.icon} size={20} /></div>
              <h3>{c.title}</h3>
              <p>{c.text}</p>
            </div>
          ))}
        </div>

        <div className="section">
          <div className="section__head">
            <h3>Ваши комнаты</h3>
            <span>остаются в этом браузере вместе с ключами — вернуться можно одним нажатием</span>
          </div>
          <div className="check">
            {history.length === 0 ? (
              <div className="check__row">
                <Icon name="info" size={18} />
                <div className="check__name">
                  <b>Пока пусто</b>
                  <small>Создайте комнату — она появится здесь, чтобы звать тех же людей ещё раз.</small>
                </div>
              </div>
            ) : null}
            {history.map((r) => (
              <div className="check__row" key={r.code}>
                <Avatar name={r.code} size="sm" />
                <div className="check__name">
                  <b>{r.code}</b>
                  <small>
                    последний раз: {new Date(r.at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
                  </small>
                </div>
                <button className="btn btn--sm btn--brand" onClick={() => onJoin(r.code, r.secret)}>
                  <Icon name="volume" size={15} /> Войти
                </button>
                <button className="iconbtn" onClick={() => onForget(r.code)} title="Убрать" aria-label="Убрать комнату">
                  <Icon name="x" size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="section">
          <div className="section__head">
            <h3>Проверка связи</h3>
            <span>что мешает, если у кого-то не работает звук</span>
            <span className="grow" />
            <button className="btn btn--sm btn--ghost" onClick={onDiag} disabled={diag.running}>
              <Icon name="refresh" size={16} className={diag.running ? 'spin' : ''} />
              {diag.running ? 'Проверяю…' : 'Проверить'}
            </button>
          </div>
          <div className="check">
            {diag.rows.length === 0 ? (
              <div className="check__row">
                <Icon name="shield" size={18} />
                <div className="check__name">
                  <b>Нажмите «Проверить»</b>
                  <small>Проверим https, устройства, показ экрана, релей знакомства и проход через NAT.</small>
                </div>
              </div>
            ) : null}
            {diag.rows.map((row) => <CheckRow key={row.id} row={row} />)}
          </div>
        </div>

        <div className="section">
          <div className="section__head">
            <h3>С чего начать</h3>
            <span>три шага</span>
          </div>
          <div className="steps">
            <div className="step">
              <h4>Создайте комнату</h4>
              <p>Кнопка «Создать комнату» даст короткий код и ссылку с ключом шифрования.</p>
            </div>
            <div className="step">
              <h4>Отправьте ссылку</h4>
              <p>Друзья открывают её в браузере — сразу попадают в комнату, ничего ставить не нужно.</p>
            </div>
            <div className="step">
              <h4>Включите камеру и говорите</h4>
              <p>Микрофон и камера включаются кнопками слева внизу. Демонстрация экрана — клавишей S.</p>
            </div>
          </div>
        </div>

        <div className="section">
          <div className="check__row" style={{ padding: '14px 16px' }}>
            <Icon name="shield" size={18} />
            <div className="check__name">
              <b>Что видит сервер</b>
              <small>
                Только шифрованные посылки знакомства: кто в комнате и как соединиться. Чат, доска, звук и видео
                идут между браузерами напрямую и на сервер не попадают. Ключ комнаты лежит в ссылке после «#» —
                браузер не отправляет его на сервер никогда.
              </small>
            </div>
            <button className="btn btn--sm btn--ghost" onClick={onHelp}>Подробнее</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export { fmtDuration, isSecure };
