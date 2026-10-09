import { useState } from 'react';
import { GAME_TITLE } from '../config';
import { BotLevel } from '../game/bot';
import { MAX_PLAYERS } from '../game/engine';
import { Dict, useT } from '../i18n';
import { SERVER_URL } from '../net/online';
import { normalizeRoomCode } from '../net/protocol';
import { ServerStatus, useServerStatus } from '../net/status';
import { IS_TELEGRAM } from '../platform';
import { Rules } from './Rules';
import { LanguageSwitch } from './LanguageSwitch';
import { SoundToggle } from './SoundToggle';
import { NotifyToggle } from './NotifyToggle';
import { Support } from './Support';

interface MenuProps {
  name: string;
  onNameChange: (name: string) => void;
  initialCode: string;
  /** есть ли в этой сборке игра по сети */
  online: boolean;
  /** быстрый подбор соперников — только с игровым сервером */
  quick: boolean;
  onPlayBots: (opponents: number, level: BotLevel) => void;
  onQuick: () => void;
  onHost: () => void;
  onJoin: (code: string) => void;
  onTutorial: () => void;
}

export const botLevels = (t: Dict): { id: BotLevel; label: string }[] => [
  { id: 'easy', label: t.botEasy },
  { id: 'normal', label: t.botNormal },
];

export function Menu({
  name,
  onNameChange,
  initialCode,
  online,
  quick,
  onPlayBots,
  onQuick,
  onHost,
  onJoin,
  onTutorial,
}: MenuProps) {
  const t = useT();
  const [opponents, setOpponents] = useState(1);
  const [level, setLevel] = useState<BotLevel>('normal');
  const [code, setCode] = useState(initialCode);
  const [showRules, setShowRules] = useState(false);
  // доступность игрового сервера — видна в заголовке «Онлайн»; без сервера кнопки не горят
  const { status: server, recheck } = useServerStatus(online && quick ? SERVER_URL : '');
  const offline = server?.kind === 'offline';

  return (
    <div className="screen">
      <div className="menu-head">
        <div className="menu-side">
          <SoundToggle />
        </div>
        <h1 className="title">{GAME_TITLE}</h1>
        <div className="menu-side end">
          <LanguageSwitch />
        </div>
      </div>
      <p className="muted subtitle">{t.subtitle}</p>

      <div className="panel">
        <h2>{t.vsBots}</h2>
        <div className="field">
          <span>{t.opponents}</span>
          <div className="segmented">
            {Array.from({ length: MAX_PLAYERS - 1 }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                className={n === opponents ? 'on' : ''}
                aria-pressed={n === opponents}
                onClick={() => setOpponents(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>{t.bots}</span>
          <div className="segmented">
            {botLevels(t).map((l) => (
              <button
                key={l.id}
                type="button"
                className={l.id === level ? 'on' : ''}
                aria-pressed={l.id === level}
                onClick={() => setLevel(l.id)}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
        <button type="button" className="btn primary wide" onClick={() => onPlayBots(opponents, level)}>
          {t.play}
        </button>
      </div>

      {online && (
        <div className="panel">
          <div className="panel-head">
            <h2>{t.online}</h2>
            {server && <ServerBadge status={server} />}
          </div>
          {offline && (
            <>
              <p className="error hint">{t.serverOfflineNote}</p>
              <button type="button" className="btn wide" onClick={recheck}>
                {t.recheck}
              </button>
            </>
          )}
          {/* имя видят только соперники по сети, поэтому оно спрашивается здесь */}
          <label className="field">
            <span>{t.yourName}</span>
            <input
              value={name}
              maxLength={16}
              placeholder={t.defaultName}
              onChange={(e) => onNameChange(e.target.value)}
            />
          </label>
          {quick && (
            <>
              <button type="button" className="btn primary wide" disabled={offline} onClick={onQuick}>
                {t.quickMatch}
              </button>
              <p className="muted hint">{t.quickNote}</p>
              {IS_TELEGRAM && <NotifyToggle />}
              <h3 className="sub">{t.withFriends}</h3>
            </>
          )}
          <button type="button" className="btn wide" disabled={offline} onClick={onHost}>
            {t.createRoom}
          </button>
          <form
            className="join"
            onSubmit={(e) => {
              e.preventDefault();
              const clean = normalizeRoomCode(code);
              if (clean && !offline) onJoin(clean);
            }}
          >
            <input
              value={code}
              placeholder={t.roomCode}
              maxLength={8}
              aria-label={t.roomCode}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <button type="submit" className="btn" disabled={offline || !normalizeRoomCode(code)}>
              {t.join}
            </button>
          </form>
        </div>
      )}

      {IS_TELEGRAM && <Support />}

      <div className="menu-help">
        <button type="button" className="btn" onClick={onTutorial}>
          {t.tutorial}
        </button>
        <button type="button" className="btn" onClick={() => setShowRules(true)}>
          {t.rules}
        </button>
      </div>

      {showRules && <Rules onClose={() => setShowRules(false)} />}
    </div>
  );
}

/** Огонёк сервера: зелёный — на связи, красный — недоступен, мигает — проверяем. */
function ServerBadge({ status }: { status: ServerStatus }) {
  const t = useT();
  let text = t.serverChecking;
  if (status.kind === 'online') {
    text = status.searching > 0 ? `${t.serverOnline} · ${t.serverSearching(status.searching)}` : t.serverOnline;
  } else if (status.kind === 'offline') {
    text = t.serverOffline;
  }
  return (
    <span className={`server-badge ${status.kind}`} role="status">
      <span className="dot" aria-hidden="true" />
      {text}
    </span>
  );
}
