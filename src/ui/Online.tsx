import { useEffect, useState } from 'react';
import { BotLevel } from '../game/bot';
import { MAX_PLAYERS, MIN_PLAYERS } from '../game/engine';
import { Session } from '../game/session';
import { GuestClient, GuestState, HostRoom, HostRoomState } from '../net/room';
import { BOT_LEVELS } from './Menu';
import { Table } from './Table';

function roomLink(code: string): string {
  return `${location.origin}${location.pathname}?room=${code}`;
}

export function HostScreen({ room, hostName, onExit }: { room: HostRoom; hostName: string; onExit: () => void }) {
  const [state, setState] = useState<HostRoomState>(room.state.get());
  const [session, setSession] = useState<Session | null>(null);
  const [bots, setBots] = useState(0);
  const [level, setLevel] = useState<BotLevel>('normal');
  const [copied, setCopied] = useState(false);

  useEffect(() => room.state.subscribe(setState), [room]);

  if (session) return <Table session={session} onExit={onExit} />;

  const maxBots = MAX_PLAYERS - 1 - state.guests.length;
  const botCount = Math.min(bots, maxBots);
  const total = 1 + state.guests.length + botCount;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(roomLink(state.code));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="screen">
      <h1 className="title small">Комната</h1>
      {state.status === 'opening' && <p className="muted">Создаём комнату…</p>}
      {state.status === 'error' && <p className="error">{state.error}</p>}
      {state.status === 'open' && (
        <>
          <div className="panel">
            <span className="muted">Код комнаты</span>
            <div className="room-code">{state.code}</div>
            <button type="button" className="btn wide" onClick={copy}>
              {copied ? 'Ссылка скопирована' : 'Скопировать ссылку'}
            </button>
            <p className="muted hint">Отправьте друзьям ссылку или код. Не закрывайте эту вкладку — игру ведёт она.</p>
          </div>

          <div className="panel">
            <h2>Игроки</h2>
            <ul className="players">
              <li>{hostName} (вы)</li>
              {state.guests.map((guest, i) => (
                <li key={i}>{guest}</li>
              ))}
              {Array.from({ length: botCount }, (_, i) => (
                <li key={`bot${i}`} className="muted">
                  Бот {i + 1}
                </li>
              ))}
            </ul>
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
              onClick={() => setSession(room.startGame(botCount, level))}
            >
              {total < MIN_PLAYERS ? 'Ждём игроков…' : `Начать игру (${total})`}
            </button>
          </div>
        </>
      )}
      <button type="button" className="btn ghost" onClick={onExit}>
        Назад
      </button>
    </div>
  );
}

export function GuestScreen({ client, onExit }: { client: GuestClient; onExit: () => void }) {
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
    <div className="screen">
      <h1 className="title small">Комната</h1>
      {state.status === 'connecting' && <p className="muted">Подключаемся…</p>}
      {state.status === 'error' && <p className="error">{state.error}</p>}
      {state.status === 'closed' && <p className="error">Хост закрыл комнату</p>}
      {state.status === 'lobby' && (
        <div className="panel">
          <h2>Игроки</h2>
          <ul className="players">
            {state.names.map((name, i) => (
              <li key={i}>{i === state.you ? `${name} (вы)` : name}</li>
            ))}
          </ul>
          <p className="muted hint">Ждём, пока хост начнёт игру…</p>
        </div>
      )}
      <button type="button" className="btn ghost" onClick={onExit}>
        Назад
      </button>
    </div>
  );
}
