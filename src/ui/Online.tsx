import { useEffect, useState } from 'react';
import { BotLevel } from '../game/bot';
import { MAX_PLAYERS, MIN_PLAYERS } from '../game/engine';
import { Session } from '../game/session';
import { OnlineRoom, OnlineState } from '../net/online';
import { GuestClient, GuestState, HostRoom, HostRoomState } from '../net/room';
import { BOT_LEVELS } from './Menu';
import { Table } from './Table';

function roomLink(code: string): string {
  return `${location.origin}${location.pathname}?room=${code}`;
}

interface LobbyProps {
  code: string;
  names: string[];
  you: number;
  /** владелец комнаты добавляет ботов и начинает игру */
  onStart?: (bots: number, level: BotLevel) => void;
  hint?: string;
}

function Lobby({ code, names, you, onStart, hint }: LobbyProps) {
  const [bots, setBots] = useState(0);
  const [level, setLevel] = useState<BotLevel>('normal');
  const [copied, setCopied] = useState(false);

  const maxBots = MAX_PLAYERS - names.length;
  const botCount = Math.min(bots, maxBots);
  const total = names.length + botCount;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(roomLink(code));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      <div className="panel">
        <span className="muted">Код комнаты</span>
        <div className="room-code">{code}</div>
        <button type="button" className="btn wide" onClick={copy}>
          {copied ? 'Ссылка скопирована' : 'Скопировать ссылку'}
        </button>
        {hint && <p className="muted hint">{hint}</p>}
      </div>

      <div className="panel">
        <h2>Игроки</h2>
        <ul className="players">
          {names.map((name, i) => (
            <li key={i}>{i === you ? `${name} (вы)` : name}</li>
          ))}
          {onStart &&
            Array.from({ length: botCount }, (_, i) => (
              <li key={`bot${i}`} className="muted">
                Бот {i + 1}
              </li>
            ))}
        </ul>
        {onStart ? (
          <>
            <div className="field">
              <span>Добавить ботов</span>
              <div className="segmented">
                {Array.from({ length: maxBots + 1 }, (_, n) => (
                  <button
                    key={n}
                    type="button"
                    className={n === botCount ? 'on' : ''}
                    aria-pressed={n === botCount}
                    onClick={() => setBots(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            {botCount > 0 && (
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
            )}
            <button
              type="button"
              className="btn primary wide"
              disabled={total < MIN_PLAYERS}
              onClick={() => onStart(botCount, level)}
            >
              {total < MIN_PLAYERS ? 'Ждём игроков…' : `Начать игру (${total})`}
            </button>
          </>
        ) : (
          <p className="muted hint">Ждём, пока создатель комнаты начнёт игру…</p>
        )}
      </div>
    </>
  );
}

function RoomFrame({ children, onExit }: { children: React.ReactNode; onExit: () => void }) {
  return (
    <div className="screen">
      <h1 className="title small">Комната</h1>
      {children}
      <button type="button" className="btn ghost" onClick={onExit}>
        Назад
      </button>
    </div>
  );
}

/** Комната на игровом сервере. */
export function OnlineScreen({ room, onExit }: { room: OnlineRoom; onExit: () => void }) {
  const [state, setState] = useState<OnlineState>(room.state.get());
  const [started, setStarted] = useState(false);

  useEffect(
    () =>
      room.state.subscribe((next) => {
        setState(next);
        if (next.status === 'game') setStarted(true);
      }),
    [room],
  );

  if (started) {
    let notice: string | undefined;
    if (state.status === 'reconnecting') notice = 'Восстанавливаем связь…';
    if (state.status === 'closed') notice = state.error ?? 'Связь с сервером потеряна';
    return <Table session={room} onExit={onExit} notice={notice} />;
  }

  return (
    <RoomFrame onExit={onExit}>
      {state.status === 'connecting' && <p className="muted">Подключаемся…</p>}
      {(state.status === 'error' || state.status === 'closed') && <p className="error">{state.error}</p>}
      {state.status === 'lobby' && (
        <Lobby
          code={state.code}
          names={state.names}
          you={state.you}
          onStart={state.you === state.owner ? (bots, level) => room.start(bots, level) : undefined}
          hint="Отправьте друзьям ссылку или код."
        />
      )}
    </RoomFrame>
  );
}

/** Комната без сервера: партию ведёт вкладка создателя. */
export function HostScreen({ room, hostName, onExit }: { room: HostRoom; hostName: string; onExit: () => void }) {
  const [state, setState] = useState<HostRoomState>(room.state.get());
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => room.state.subscribe(setState), [room]);

  if (session) return <Table session={session} onExit={onExit} />;

  return (
    <RoomFrame onExit={onExit}>
      {state.status === 'opening' && <p className="muted">Создаём комнату…</p>}
      {state.status === 'error' && <p className="error">{state.error}</p>}
      {state.status === 'open' && (
        <Lobby
          code={state.code}
          names={[hostName, ...state.guests]}
          you={0}
          onStart={(bots, level) => setSession(room.startGame(bots, level))}
          hint="Отправьте друзьям ссылку или код. Не закрывайте эту вкладку — игру ведёт она."
        />
      )}
    </RoomFrame>
  );
}

export function GuestScreen({ client, code, onExit }: { client: GuestClient; code: string; onExit: () => void }) {
  const [state, setState] = useState<GuestState>(client.state.get());
  const [started, setStarted] = useState(false);

  useEffect(
    () =>
      client.state.subscribe((next) => {
        setState(next);
        if (next.status === 'game') setStarted(true);
      }),
    [client],
  );

  if (started) {
    return (
      <Table
        session={client}
        onExit={onExit}
        notice={state.status === 'closed' ? 'Связь с хостом потеряна' : undefined}
      />
    );
  }

  return (
    <RoomFrame onExit={onExit}>
      {state.status === 'connecting' && <p className="muted">Подключаемся…</p>}
      {state.status === 'error' && <p className="error">{state.error}</p>}
      {state.status === 'closed' && <p className="error">Хост закрыл комнату</p>}
      {state.status === 'lobby' && <Lobby code={code} names={state.names} you={state.you} />}
    </RoomFrame>
  );
}
