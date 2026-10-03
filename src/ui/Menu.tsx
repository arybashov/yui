import { useState } from 'react';
import { GAME_TITLE } from '../config';
import { BotLevel } from '../game/bot';
import { MAX_PLAYERS } from '../game/engine';
import { Dict, useT } from '../i18n';
import { normalizeRoomCode } from '../net/protocol';
import { Rules } from './Rules';
import { Settings } from './Settings';

interface MenuProps {
  name: string;
  onNameChange: (name: string) => void;
  initialCode: string;
  /** есть ли в этой сборке игра по сети */
  online: boolean;
  onPlayBots: (opponents: number, level: BotLevel) => void;
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
  onPlayBots,
  onHost,
  onJoin,
  onTutorial,
}: MenuProps) {
  const t = useT();
  const [opponents, setOpponents] = useState(1);
  const [level, setLevel] = useState<BotLevel>('normal');
  const [code, setCode] = useState(initialCode);
  const [showRules, setShowRules] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div className="screen">
      <div className="menu-head">
        <div className="menu-side" />
        <h1 className="title">{GAME_TITLE}</h1>
        <div className="menu-side end">
          <button
            type="button"
            className="btn icon"
            aria-label={t.settings}
            title={t.settings}
            onClick={() => setShowSettings(true)}
          >
            <GearIcon />
          </button>
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
          <h2>{t.online}</h2>
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
          <button type="button" className="btn wide" onClick={onHost}>
            {t.createRoom}
          </button>
          <form
            className="join"
            onSubmit={(e) => {
              e.preventDefault();
              const clean = normalizeRoomCode(code);
              if (clean) onJoin(clean);
            }}
          >
            <input
              value={code}
              placeholder={t.roomCode}
              maxLength={8}
              aria-label={t.roomCode}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <button type="submit" className="btn" disabled={!normalizeRoomCode(code)}>
              {t.join}
            </button>
          </form>
        </div>
      )}

      <div className="menu-help">
        <button type="button" className="btn" onClick={onTutorial}>
          {t.tutorial}
        </button>
        <button type="button" className="btn" onClick={() => setShowRules(true)}>
          {t.rules}
        </button>
      </div>

      {showRules && <Rules onClose={() => setShowRules(false)} />}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
    </div>
  );
}

/** Шестерёнка — общепонятный значок настроек, его находят без знания языка (требование 6.9). */
export function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
      <path d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6a.5.5 0 0 0 .1-.6l-2-3.5a.5.5 0 0 0-.6-.2l-2.5 1a7.4 7.4 0 0 0-1.7-1l-.4-2.6a.5.5 0 0 0-.5-.4h-4a.5.5 0 0 0-.5.4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1a.5.5 0 0 0-.6.2l-2 3.5a.5.5 0 0 0 .1.6L4.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6a.5.5 0 0 0-.1.6l2 3.5a.5.5 0 0 0 .6.2l2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.6a.5.5 0 0 0 .5.4h4a.5.5 0 0 0 .5-.4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.5 1a.5.5 0 0 0 .6-.2l2-3.5a.5.5 0 0 0-.1-.6L19.4 13zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" />
    </svg>
  );
}
