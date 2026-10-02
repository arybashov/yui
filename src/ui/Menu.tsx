import { useState } from 'react';
import { GAME_TITLE } from '../config';
import { BotLevel } from '../game/bot';
import { MAX_PLAYERS } from '../game/engine';
import { Dict, LANGS, chooseLang, langName, useLang, useT } from '../i18n';
import { normalizeRoomCode } from '../net/protocol';
import { Rules } from './Rules';
import { SoundSwitch } from './SoundToggle';

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

/** Переключатель языка. Языки подписаны на них самих, чтобы его можно было найти, не зная текущего. */
function LanguageSwitch() {
  const t = useT();
  const lang = useLang();
  return (
    <div className="field">
      <span>
        <span aria-hidden="true">🌐 </span>
        {t.language}
      </span>
      <div className="segmented">
        {LANGS.map((code) => (
          <button
            key={code}
            type="button"
            className={code === lang ? 'on' : ''}
            aria-pressed={code === lang}
            onClick={() => chooseLang(code)}
          >
            {langName(code)}
          </button>
        ))}
      </div>
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
      <h1 className="title">{GAME_TITLE}</h1>
      <p className="muted subtitle">{t.subtitle}</p>

      <div className="panel">
        <label className="field">
          <span>{t.yourName}</span>
          <input
            value={name}
            maxLength={16}
            placeholder={t.defaultName}
            onChange={(e) => onNameChange(e.target.value)}
          />
        </label>
        <SoundSwitch />
        <LanguageSwitch />
      </div>

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

      <div className="panel">
        <h2>{t.howToPlay}</h2>
        <button type="button" className="btn wide" onClick={onTutorial}>
          {t.tutorial}
        </button>
        <button type="button" className="btn ghost" onClick={() => setShowRules(true)}>
          {t.rulesAsText}
        </button>
      </div>

      {showRules && <Rules onClose={() => setShowRules(false)} />}
    </div>
  );
}
