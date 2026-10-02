import { useState } from 'react';
import { GAME_TITLE } from '../config';
import { BotLevel } from '../game/bot';
import { MAX_PLAYERS } from '../game/engine';
import { Dict, LANGS, Lang, chooseLang, langName, useLang, useT } from '../i18n';
import { normalizeRoomCode } from '../net/protocol';
import { Rules } from './Rules';
import { SoundToggle } from './SoundToggle';

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

/** Флаги нарисованы картинками: эмодзи-флаги на Windows показываются буквами. */
const FLAGS: Record<Lang, React.ReactNode> = {
  ru: (
    <svg viewBox="0 0 9 6" preserveAspectRatio="none" aria-hidden="true">
      <rect width="9" height="2" fill="#fff" />
      <rect y="2" width="9" height="2" fill="#0039a6" />
      <rect y="4" width="9" height="2" fill="#d52b1e" />
    </svg>
  ),
  en: (
    <svg viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <clipPath id="flag-en-quarters">
        <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
      </clipPath>
      <path d="M0,0 v30 h60 v-30 z" fill="#012169" />
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
      <path d="M0,0 L60,30 M60,0 L0,30" clipPath="url(#flag-en-quarters)" stroke="#c8102e" strokeWidth="4" />
      <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
      <path d="M30,0 v30 M0,15 h60" stroke="#c8102e" strokeWidth="6" />
    </svg>
  ),
};

/** Выбор языка флагами: площадка не допускает в интерфейсе текст на другом языке,
 *  а флаг понятен, даже если текущий язык игроку незнаком. */
function LanguageSwitch() {
  const lang = useLang();
  return (
    <div className="flags">
      {LANGS.map((code) => (
        <button
          key={code}
          type="button"
          className={`flag ${code === lang ? 'on' : ''}`}
          aria-label={langName(code)}
          aria-pressed={code === lang}
          onClick={() => chooseLang(code)}
        >
          {FLAGS[code]}
        </button>
      ))}
    </div>
  );
}

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
    </div>
  );
}
