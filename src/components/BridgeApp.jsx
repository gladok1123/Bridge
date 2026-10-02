'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon.jsx';
import { Rail } from './Rail.jsx';
import { Sidebar } from './Sidebar.jsx';
import { Stage } from './Stage.jsx';
import { Chat } from './Chat.jsx';
import { Members } from './Members.jsx';
import { Board } from './Board.jsx';
import { Home } from './Home.jsx';
import { Settings } from './Settings.jsx';
import { Help } from './Help.jsx';
import { Toasts } from './Toasts.jsx';
import { Modal } from './Modal.jsx';
import { AudioSinks } from './Audio.jsx';

const isTyping = (el) => {
  if (!el) return false;
  const tag = String(el.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
};

/** Всё приложение: каркас, горячие клавиши и модальные окна. */
export function BridgeApp({ bridge, initialRoom = '', initialSecret = '' }) {
  const [layout, setLayout] = useState('focus');
  const [pinned, setPinned] = useState(null);
  const [boardOpen, setBoardOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const [soundMuted, setSoundMuted] = useState(false);
  const [joinInput, setJoinInput] = useState('');
  const [name, setName] = useState(bridge.settings.name || '');
  const videos = useRef(new Map());
  const autoTried = useRef(false);

  /* переход по прямой ссылке /r/код#k=ключ */
  useEffect(() => {
    if (autoTried.current) return;
    if (!initialRoom) return;
    autoTried.current = true;
    bridge.join(initialRoom, { secret: initialSecret || undefined });
  }, [bridge, initialRoom, initialSecret]);

  const register = useCallback((av, el, meta = {}) => {
    if (el) videos.current.set(av, { el, ...meta });
    else videos.current.delete(av);
  }, []);

  const tilesForRecording = useCallback(() => {
    const out = [];
    videos.current.forEach((t, av) => {
      out.push({ av, name: t.name, el: t.el, screen: !!t.isScreen, mirror: false });
    });
    return out;
  }, []);

  const onRecord = useCallback(() => {
    if (bridge.recording.active) bridge.stopRecording();
    else bridge.startRecording({ tiles: tilesForRecording() });
  }, [bridge, tilesForRecording]);

  const openInvite = useCallback(async () => {
    setInviteOpen(true);
  }, []);

  const copy = useCallback(async () => {
    await bridge.copyInvite();
  }, [bridge]);

  /* горячие клавиши */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (boardOpen) return setBoardOpen(false);
        if (settingsOpen) return setSettingsOpen(false);
        if (helpOpen) return setHelpOpen(false);
        if (inviteOpen) return setInviteOpen(false);
        if (renameOpen) return setRenameOpen(false);
        return undefined;
      }
      if (isTyping(document.activeElement) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (bridge.phase !== 'room') {
        if (k === '/') {
          e.preventDefault();
          const el = document.querySelector('.join__input');
          if (el) el.focus();
        }
        return;
      }
      if (k === 'm') bridge.toggleMic();
      else if (k === 'v') bridge.toggleCam();
      else if (k === 's') bridge.shareScreen();
      else if (k === 'h') bridge.toggleHand();
      else if (k === 'b') setBoardOpen((v) => !v);
      else if (k === 'r') onRecord();
      else if (k === 'u') setMembersOpen((v) => !v);
      else if (k === 'c') bridge.update({ chatSize: bridge.settings.chatSize === 'lg' ? 'sm' : bridge.settings.chatSize === 'sm' ? 'md' : 'lg' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [boardOpen, bridge, helpOpen, inviteOpen, onRecord, renameOpen, settingsOpen]);

  const relayTone = bridge.relayStatus && bridge.relayStatus.ok ? 'ok' : bridge.relayStatus && bridge.relayStatus.error ? 'warn' : '';
  const direct = Object.values(bridge.links || {}).filter((l) => l && l.dcOpen).length;

  return (
    <div className="app" data-members={membersOpen ? '1' : '0'} data-drawer={drawer ? '1' : '0'}>
      <Rail
        phase={bridge.phase}
        room={bridge.room}
        history={bridge.history}
        me={bridge.me}
        onHome={() => { if (bridge.phase === 'room') bridge.leave(); setDrawer(false); }}
        onJoin={(code, secret) => { bridge.join(code, { secret }); setDrawer(false); }}
        onNew={() => { bridge.join(bridge.newRoom()); setDrawer(false); }}
        onSettings={() => setSettingsOpen(true)}
        onHelp={() => setHelpOpen(true)}
      />

      <Sidebar
        phase={bridge.phase}
        room={bridge.room}
        history={bridge.history}
        counts={bridge.counts}
        peers={bridge.peers}
        me={bridge.me}
        media={bridge.media}
        links={bridge.links}
        speaking={bridge.speaking}
        relayStatus={bridge.relayStatus}
        recording={bridge.recording}
        sound={soundMuted}
        membersOpen={membersOpen}
        onSound={() => { const v = !soundMuted; setSoundMuted(v); bridge.setSound(v); }}
        onHome={() => setDrawer(false)}
        onJoin={(code, secret) => { bridge.join(code, { secret }); setDrawer(false); }}
        onNew={() => { bridge.join(bridge.newRoom()); setDrawer(false); }}
        onForget={bridge.forget}
        onRename={() => { setName(bridge.me.name || ''); setRenameOpen(true); }}
        onSettings={() => setSettingsOpen(true)}
        onToggleMic={bridge.toggleMic}
        onToggleCam={bridge.toggleCam}
        onShareScreen={bridge.shareScreen}
        onToggleHand={bridge.toggleHand}
        onBoard={() => setBoardOpen(true)}
        onRecord={onRecord}
        onLeave={bridge.leave}
        onInvite={openInvite}
        onHelp={() => setHelpOpen(true)}
        onToggleMembers={() => setMembersOpen((v) => !v)}
      />

      <main className="main">
        <div className="main__head">
          <button className="iconbtn hide-wide" onClick={() => setDrawer((v) => !v)} aria-label="Меню">
            <Icon name="menu" size={20} />
          </button>
          <div className="main__title">
            <Icon name={bridge.phase === 'room' ? 'volume' : 'logo'} size={20} />
            <h2>{bridge.phase === 'room' ? bridge.room.code : 'Bridge'}</h2>
            {bridge.phase === 'room' ? (
              <>
                <span className="chip" title="Код комнаты">{bridge.room.fp ? 'ключ ' + bridge.room.fp : bridge.room.code}</span>
                <span className="main__sub hide-sm">
                  {bridge.counts.total} чел. · напрямую: {direct}
                  {bridge.media.screen ? ' · вы показываете экран' : ''}
                </span>
              </>
            ) : (
              <span className="main__sub hide-sm">прямые звонки, доска и чат — без регистрации</span>
            )}
          </div>
          <div className="main__tools">
            {bridge.phase === 'room' ? (
              <>
                <button className="btn btn--sm btn--brand" onClick={openInvite} title="Позвать друзей">
                  <Icon name="link" size={16} /> Позвать
                </button>
                <button className={'iconbtn ' + (boardOpen ? 'is-on' : '')} onClick={() => setBoardOpen(true)} title="Доска (B)">
                  <Icon name="board" size={18} />
                </button>
                <button className={'iconbtn ' + (bridge.recording.active ? 'is-on' : '')} onClick={onRecord} title="Запись (R)">
                  <Icon name="sparkles" size={18} />
                </button>
                <button className={'iconbtn ' + (membersOpen ? 'is-on' : '')} onClick={() => setMembersOpen((v) => !v)} title="Участники (U)">
                  <Icon name="users" size={18} />
                </button>
                <button className="iconbtn" onClick={() => setSettingsOpen(true)} title="Настройки">
                  <Icon name="gear" size={18} />
                </button>
              </>
            ) : (
              <>
                <button className="btn btn--sm btn--brand" onClick={() => bridge.join(bridge.newRoom())}>
                  <Icon name="plus" size={16} /> Новая комната
                </button>
                <button className="iconbtn" onClick={bridge.runDiag} title="Проверить связь">
                  <Icon name="shield" size={18} />
                </button>
                <button className="iconbtn" onClick={() => setSettingsOpen(true)} title="Настройки">
                  <Icon name="gear" size={18} />
                </button>
              </>
            )}
          </div>
        </div>

        {bridge.phase === 'room' ? (
          <div className="main__body">
            <Stage
              me={bridge.me}
              peers={bridge.peers}
              media={bridge.media}
              speaking={bridge.speaking}
              links={bridge.links}
              remoteStream={bridge.remoteStream}
              myStreams={bridge.localStreams}
              register={register}
              layout={layout}
              onLayout={setLayout}
              pinned={pinned}
              onPin={setPinned}
              showStats={bridge.settings.showStats}
              recording={bridge.recording}
              onStartRecord={onRecord}
              onStopShare={bridge.shareScreen}
              onTurnOnCam={bridge.toggleCam}
              relayStatus={bridge.relayStatus}
              screenTuning={{
                quality: Number(bridge.settings.screenQuality) || 1080,
                fps: Number(bridge.settings.screenFps) || 30,
                bitrate: Number(bridge.settings.screenBitrate) || 0,
                hint: bridge.settings.streamHint || 'auto',
              }}
              onScreenTuning={(patch) => {
                /* плюшки показываем по-человечески: 2160 → 4K */
                const map = { quality: 'screenQuality', fps: 'screenFps', bitrate: 'screenBitrate', hint: 'streamHint' };
                const next = {};
                Object.entries(patch).forEach(([k, v]) => { if (map[k]) next[map[k]] = v; });
                bridge.update(next);
              }}
            />
            <Chat
              chat={bridge.state.chat}
              me={bridge.me}
              counts={bridge.counts}
              relayStatus={bridge.relayStatus}
              size={bridge.settings.chatSize || 'md'}
              onSize={(v) => bridge.update({ chatSize: v })}
              onSend={bridge.sendChat}
              onReact={bridge.react}
            />
          </div>
        ) : (
          <Home
            me={bridge.me}
            history={bridge.history}
            settings={bridge.settings}
            update={bridge.update}
            onJoin={bridge.join}
            onNew={bridge.newRoom}
            onForget={bridge.forget}
            onSettings={() => setSettingsOpen(true)}
            onHelp={() => setHelpOpen(true)}
            diag={bridge.diag}
            onDiag={bridge.runDiag}
            secure={bridge.secure}
          />
        )}
      </main>

      <Members
        me={bridge.me}
        media={bridge.media}
        peers={bridge.peers}
        links={bridge.links}
        speaking={bridge.speaking}
        showStats={bridge.settings.showStats}
        relayStatus={bridge.relayStatus}
        onClose={() => setMembersOpen(false)}
      />

      {/* чужой звук идёт отдельными элементами: их не видно, но слышно */}
      <AudioSinks peers={bridge.peers} remoteStream={bridge.remoteStream} muted={false} trackRev={bridge.trackRev} />

      <Toasts items={bridge.toasts} onClose={bridge.dropToast} />

      {boardOpen ? (
        <Board
          store={bridge.board.store}
          rev={bridge.boardRev}
          board={bridge.board}
          me={bridge.me}
          onClose={() => setBoardOpen(false)}
          onUndo={bridge.board.undo}
          onClear={bridge.board.clear}
        />
      ) : null}

      {settingsOpen ? (
        <Settings
          settings={bridge.settings}
          update={bridge.update}
          me={bridge.me}
          media={bridge.media}
          diag={bridge.diag}
          tone={bridge.diagTone}
          onDiag={bridge.runDiag}
          onRename={bridge.rename}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}

      {helpOpen ? (
        <Help room={bridge.room} onClose={() => setHelpOpen(false)} onSettings={() => setSettingsOpen(true)} />
      ) : null}

      {inviteOpen ? (
        <Modal
          title={'Позвать в комнату «' + bridge.room.code + '»'}
          icon="link"
          onClose={() => setInviteOpen(false)}
          footer={(
            <>
              <button className="btn btn--ghost" onClick={() => setInviteOpen(false)}>Готово</button>
              <button className="btn btn--brand" onClick={copy}>
                <Icon name="copy" size={16} /> Скопировать ссылку
              </button>
            </>
          )}
        >
          <p className="hint" style={{ marginTop: 0 }}>
            Отправьте эту ссылку друзьям. В ней уже лежит ключ комнаты — по ней они попадут сразу сюда,
            и вы услышите друг друга.
          </p>
          <div className="field">
            <label>Ссылка-приглашение</label>
            <input className="input" readOnly value={bridge.inviteUrl} onFocus={(e) => e.target.select()} />
          </div>
          <div className="field">
            <label>Или просто код</label>
            <input className="input" readOnly value={bridge.room.code} onFocus={(e) => e.target.select()} />
            <small>Код без ключа подойдёт, если договориться о ключе заранее, но со ссылкой надёжнее.</small>
          </div>
          {typeof navigator !== 'undefined' && navigator.share ? (
            <button
              className="btn btn--ghost"
              onClick={() => navigator.share({ title: 'Bridge', text: 'Заходи в звонок', url: bridge.inviteUrl }).catch(() => {})}
            >
              <Icon name="send" size={16} /> Поделиться…
            </button>
          ) : null}
        </Modal>
      ) : null}

      {renameOpen ? (
        <Modal
          title="Профиль"
          icon="user"
          onClose={() => setRenameOpen(false)}
          footer={(
            <>
              <button className="btn btn--ghost" onClick={() => setRenameOpen(false)}>Отмена</button>
              <button
                className="btn btn--brand"
                onClick={() => { if (name.trim()) bridge.rename(name); setRenameOpen(false); }}
              >
                Сохранить
              </button>
            </>
          )}
        >
          <div className="field">
            <label>Как вас зовут в комнате</label>
            <input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Например, Аня" />
            <small>Имя увидят участники комнаты. Изменить можно в любой момент — оно обновится у всех сразу.</small>
          </div>
          <div className="field">
            <label>Комната</label>
            <input className="input" readOnly value={bridge.room.code} onFocus={(e) => e.target.select()} />
            <small>Ключ: {bridge.room.fp || '—'}</small>
          </div>
          <button className="btn btn--red" onClick={() => { setRenameOpen(false); bridge.leave(); }}>
            <Icon name="phoneOff" size={16} /> Выйти из звонка
          </button>
        </Modal>
      ) : null}
    </div>
  );
}
