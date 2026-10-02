import { useState } from 'react';
import { GAME_TITLE } from '../config';
import { BotLevel } from '../game/bot';
import { MAX_PLAYERS } from '../game/engine';
import { normalizeRoomCode } from '../net/protocol';
import { Rules } from './Rules';
import { SoundSwitch } from './SoundToggle';

interface MenuProps {
  name: string;
  onNameChange: (name: string) => void;
  initialCode: string;
  onPlayBots: (opponents: number, level: BotLevel) => void;
  onHost: () => void;
  onJoin: (code: string) => void;
  onTutorial: () => void;
}

export const BOT_LEVELS: { id: BotLevel; label: string }[] = [
  { id: 'easy', label: 'Простые' },
  { id: 'normal', label: 'Обычные' },
];

export function Menu({
  name,
  onNameChange,
  initialCode,
  onPlayBots,
  onHost,
  onJoin,
  onTutorial,
}: MenuProps) {
  const [opponents, setOpponents] = useState(1);
  const [level, setLevel] = useState<BotLevel>('normal');
  const [code, setCode] = useState(initialCode);
  const [showRules, setShowRules] = useState(false);

  return (
    <div className="screen">
      <h1 className="title">{GAME_TITLE}</h1>
      <p className="muted subtitle">20 карт, ни мастей, ни козырей — сбрось всё первым</p>

      <div className="panel">
        <label className="field">
          <span>Ваше имя</span>
          <input
            value={name}
            maxLength={16}
            placeholder="Игрок"
            onChange={(e) => onNameChange(e.target.value)}
          />
        </label>
        <SoundSwitch />
      </div>

      <div className="panel">
        <h2>Игра с ботами</h2>
        <div className="field">
          <span>Соперников</span>
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
          <span>Боты</span>
          <div className="segmented">
            {BOT_LEVELS.map((l) => (
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
          Играть
        </button>
      </div>

      <div className="panel">
        <h2>Онлайн с друзьями</h2>
        <button type="button" className="btn wide" onClick={onHost}>
          Создать комнату
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
            placeholder="Код комнаты"
            maxLength={8}
            aria-label="Код комнаты"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <button type="submit" className="btn" disabled={!normalizeRoomCode(code)}>
            Войти
          </button>
        </form>
      </div>

      <div className="panel">
        <h2>Как играть</h2>
        <button type="button" className="btn wide" onClick={onTutorial}>
          Обучение за 2 минуты
        </button>
        <button type="button" className="btn ghost" onClick={() => setShowRules(true)}>
          Правила текстом
        </button>
      </div>

      {showRules && <Rules onClose={() => setShowRules(false)} />}
    </div>
  );
}
