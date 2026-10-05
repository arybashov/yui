import { useEffect, useState } from 'react';
import { BotLevel } from '../game/bot';
import { MAX_PLAYERS, MIN_PLAYERS } from '../game/engine';
import { Session } from '../game/session';
import { useT } from '../i18n';
import { OnlineRoom, OnlineState } from '../net/online';
import { GuestClient, GuestState, HostRoom, HostRoomState } from '../net/room';
import { inviteLink } from '../platform/yandex';
import { botLevels } from './Menu';
import { Table } from './Table';

interface LobbyProps {
  code: string;
  names: string[];
  you: number;
  /** владелец комнаты добавляет ботов и начинает игру */
  onStart?: (bots: number, level: BotLevel) => void;
  hint?: string;
}

function Lobby({ code, names, you, onStart, hint }: LobbyProps) {
  const t = useT();
  const [bots, setBots] = useState(0);
  const [level, setLevel] = useState<BotLevel>('normal');
  const [copied, setCopied] = useState(false);

  const maxBots = MAX_PLAYERS - names.length;
  const botCount = Math.min(bots, maxBots);
  const total = names.length + botCount;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink(code));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      <div className="panel">
        <span className="muted">{t.roomCode}</span>
        <div className="room-code">{code}</div>
        <button type="button" className="btn wide" onClick={copy}>
          {copied ? t.linkCopied : t.copyLink}
        </button>
        {hint && <p className="muted hint">{hint}</p>}
      </div>

      <div className="panel">
        <h2>{t.players}</h2>
        <ul className="players">
          {names.map((name, i) => (
            <li key={i}>{i === you ? `${name} ${t.youSuffix}` : name}</li>
          ))}
          {onStart &&
            Array.from({ length: botCount }, (_, i) => (
              <li key={`bot${i}`} className="muted">
                {t.bot(i + 1)}
              </li>
            ))}
        </ul>
        {onStart ? (
          <>
            <div className="field">
              <span>{t.addBots}</span>
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
            )}
            <button
              type="button"
              className="btn primary wide"
              disabled={total < MIN_PLAYERS}
              onClick={() => onStart(botCount, level)}
            >
              {total < MIN_PLAYERS ? t.waitingPlayers : t.startGame(total)}
            </button>
          </>
        ) : (
          <p className="muted hint">{t.waitingOwner}</p>
        )}
      </div>
    </>
  );
}

/** Быстрая игра: сервер подбирает соперников и сам начинает партию. */
function QuickLobby({ state, onBots }: { state: OnlineState; onBots?: () => void }) {
  const t = useT();
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (state.startsAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [state.startsAt]);

  const seconds = state.startsAt === null ? null : Math.max(0, Math.ceil((state.startsAt - now) / 1000));

  return (
    <div className="panel">
      <h2>{seconds === null ? t.searching : t.foundPlayers}</h2>
      <ul className="players">
        {state.names.map((name, i) => (
          <li key={i}>{i === state.you ? `${name} ${t.youSuffix}` : name}</li>
        ))}
      </ul>
      {seconds === null ? (
        <p className="muted hint">{t.nobodyYet}</p>
      ) : (
        <p className="countdown">{t.startsIn(seconds)}</p>
      )}
      {state.online > 0 && <p className="muted hint">{t.playersOnline(state.online)}</p>}
      {seconds === null && onBots && (
        <button type="button" className="btn wide" onClick={onBots}>
          {t.playBotsInstead}
        </button>
      )}
    </div>
  );
}

function RoomFrame({
  children,
  onExit,
  title,
}: {
  children: React.ReactNode;
  onExit: () => void;
  title?: string;
}) {
  const t = useT();
  return (
    <div className="screen">
      <h1 className="title small">{title ?? t.room}</h1>
      {children}
      <button type="button" className="btn ghost" onClick={onExit}>
        {t.back}
      </button>
    </div>
  );
}

/** Комната на игровом сервере. */
export function OnlineScreen({
  room,
  onExit,
  onBots,
}: {
  room: OnlineRoom;
  onExit: () => void;
  /** уйти из поиска соперников и сыграть с ботом */
  onBots?: () => void;
}) {
  const t = useT();
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

  const error = t.netErrors[state.error ?? 'lost-server'];

  if (started) {
    let notice: string | undefined;
    if (state.status === 'reconnecting') notice = t.reconnecting;
    if (state.status === 'closed') notice = error;
    return <Table session={room} onExit={onExit} notice={notice} />;
  }

  const quick = 'quick' in room.entry;
  return (
    <RoomFrame onExit={onExit} title={quick ? t.online : undefined}>
      {state.status === 'connecting' && <p className="muted">{t.connecting}</p>}
      {(state.status === 'error' || state.status === 'closed') && (
        <>
          <p className="error">{error}</p>
          {/* боты живут в браузере, им сервер не нужен */}
          {onBots && (
            <div className="panel">
              <p className="muted hint">{t.offlineBotsNote}</p>
              <button type="button" className="btn primary wide" onClick={onBots}>
                {t.playBotsOffline}
              </button>
            </div>
          )}
        </>
      )}
      {state.status === 'lobby' && state.quick && <QuickLobby state={state} onBots={onBots} />}
      {state.status === 'lobby' && !state.quick && (
        <Lobby
          code={state.code}
          names={state.names}
          you={state.you}
          onStart={state.you === state.owner ? (bots, level) => room.start(bots, level) : undefined}
          hint={t.shareHint}
        />
      )}
    </RoomFrame>
  );
}

/** Комната без сервера: партию ведёт вкладка создателя. */
export function HostScreen({ room, hostName, onExit }: { room: HostRoom; hostName: string; onExit: () => void }) {
  const t = useT();
  const [state, setState] = useState<HostRoomState>(room.state.get());
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => room.state.subscribe(setState), [room]);

  if (session) return <Table session={session} onExit={onExit} />;

  return (
    <RoomFrame onExit={onExit}>
      {state.status === 'opening' && <p className="muted">{t.creatingRoom}</p>}
      {state.status === 'error' && <p className="error">{t.netErrors[state.error ?? 'cant-create']}</p>}
      {state.status === 'open' && (
        <Lobby
          code={state.code}
          names={[hostName, ...state.guests]}
          you={0}
          onStart={(bots, level) => setSession(room.startGame(bots, level))}
          hint={t.shareHintHost}
        />
      )}
    </RoomFrame>
  );
}

export function GuestScreen({ client, code, onExit }: { client: GuestClient; code: string; onExit: () => void }) {
  const t = useT();
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
        notice={state.status === 'closed' ? t.netErrors['lost-host'] : undefined}
      />
    );
  }

  return (
    <RoomFrame onExit={onExit}>
      {state.status === 'connecting' && <p className="muted">{t.connecting}</p>}
      {state.status === 'error' && <p className="error">{t.netErrors[state.error ?? 'connection-error']}</p>}
      {state.status === 'closed' && <p className="error">{t.netErrors['host-closed']}</p>}
      {state.status === 'lobby' && <Lobby code={code} names={state.names} you={state.you} />}
    </RoomFrame>
  );
}
