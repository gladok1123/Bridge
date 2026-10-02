'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon.jsx';
import { Avatar } from './Avatar.jsx';
import { fmtClock } from '@/lib/util.js';

const EMOJI = ['👍', '❤️', '😂', '🎉', '👀', '🔥'];

/** Одна строка чата: обычное сообщение, системная заметка или реакция. */
function Message({ m, me, onReact, grouped }) {
  const mine = m.from && m.from === me.av;
  const reacts = Object.entries(m.reacts || {});

  if (m.kind === 'system') {
    return (
      <div className="msg msg--system">
        <div className="msg__avatar" />
        <div className="msg__sys">
          <Icon name="info" size={14} />
          <span><b>{m.name}</b> {m.text}{m.extra ? ' ' + m.extra : ''}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={'msg' + (grouped ? ' msg--group' : '')}>
      {!grouped ? (
        <div className="msg__avatar">
          <Avatar name={m.name} size="lg" />
        </div>
      ) : (
        <div className="msg__avatar" />
      )}
      <span className="msg__time">{fmtClock(m.ts)}</span>
      <div className="msg__body">
        {!grouped ? (
          <div className="msg__head">
            <span className="msg__name" style={mine ? { color: '#a5adff' } : undefined}>
              {m.name}{mine ? ' (вы)' : ''}
            </span>
            <span className="msg__stamp">{fmtClock(m.ts)}</span>
          </div>
        ) : null}
        <div className="msg__text">{m.text}</div>
        {reacts.length ? (
          <div className="msg__reacts">
            {reacts.map(([emoji, list]) => (
              <button key={emoji} className="react" onClick={() => onReact(m.id, emoji)} title={list.length + ' реакций'}>
                <span>{emoji}</span>
                <span>{list.length}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="msg__float">
        {EMOJI.slice(0, 4).map((e) => (
          <button key={e} onClick={() => onReact(m.id, e)} title={'Реакция ' + e}>{e}</button>
        ))}
      </div>
    </div>
  );
}

/** Чат: история, ввод и реакции. Работает и без сервера — через прямые каналы. */
export function Chat({ chat, me, onSend, onReact, size, onSize, counts, relayStatus }) {
  const [text, setText] = useState('');
  const scrollRef = useRef(null);
  const [atBottom, setAtBottom] = useState(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (atBottom) el.scrollTop = el.scrollHeight;
  }, [chat, atBottom]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
  };

  const submit = (e) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText('');
  };

  const noPeers = counts.total <= 1;

  return (
    <section className="chat" data-size={size}>
      <div className="chat__head">
        <Icon name="hash" size={16} />
        <b>Чат комнаты</b>
        <span className="grow" />
        {relayStatus && !relayStatus.ok ? (
          <span className="state state--warn" title={relayStatus.error || ''}>
            <Icon name="alert" size={13} /> релей молчит
          </span>
        ) : (
          <span className="state state--ok">
            <Icon name="shield" size={13} /> шифруется на устройстве
          </span>
        )}
        <button
          className="iconbtn"
          onClick={() => onSize(size === 'sm' ? 'md' : size === 'md' ? 'lg' : 'sm')}
          title="Размер чата"
          aria-label="Размер чата"
        >
          <Icon name={size === 'lg' ? 'chevron' : 'chevronRight'} size={16} />
        </button>
      </div>

      <div className="chat__scroll" ref={scrollRef} onScroll={onScroll}>
        {chat.length === 0 ? (
          <div className="hint" style={{ padding: '14px 8px' }}>
            Пока пусто. Напишите первое сообщение — его увидят все, кто в комнате.
            {noPeers ? ' Сейчас в комнате только вы: позовите друзей ссылкой из шапки.' : ''}
          </div>
        ) : null}
        {chat.map((m, i) => (
          <Message
            key={m.id}
            m={m}
            me={me}
            onReact={onReact}
            grouped={i > 0 && chat[i - 1].kind === 'user' && m.kind === 'user' && chat[i - 1].from === m.from && (m.ts - chat[i - 1].ts) < 5 * 60 * 1000}
          />
        ))}
      </div>

      {!atBottom ? (
        <button className="btn btn--sm btn--brand" style={{ position: 'absolute', right: 24, bottom: 84 }} onClick={() => setAtBottom(true)}>
          Вниз <Icon name="chevron" size={14} />
        </button>
      ) : null}

      <form className="composer" onSubmit={submit}>
        <div className="composer__row">
          <textarea
            className="composer__input"
            placeholder={'Сообщение в «' + (counts.total > 1 ? 'комнату' : 'пустую комнату') + '»'}
            value={text}
            rows={1}
            onChange={(e) => setText(e.target.value.slice(0, 2000))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) submit(e);
            }}
          />
          <button className="iconbtn" type="submit" disabled={!text.trim()} aria-label="Отправить" title="Enter — отправить">
            <Icon name="send" size={18} />
          </button>
        </div>
        <div className="composer__hint">
          <span><span className="kbd">Enter</span> — отправить</span>
          <span><span className="kbd">Shift</span>+<span className="kbd">Enter</span> — с новой строки</span>
          <span className="grow" />
          <span>{text.length}/2000</span>
        </div>
      </form>
    </section>
  );
}
