import { useEffect, useState } from 'react';
import { BotLevel } from './game/bot';
import { HostSeat, HostSession, botSeatName } from './game/session';
import { useT } from './i18n';
import { OnlineRoom, SERVER_URL } from './net/online';
import { normalizeRoomCode } from './net/protocol';
import { GuestClient, HostRoom } from './net/room';
import { IS_YANDEX, invitePayload, platformPause, platformPlayerName } from './platform';
import { Menu } from './ui/Menu';
import { GuestScreen, HostScreen, OnlineScreen } from './ui/Online';
import { Table } from './ui/Table';
import { Tutorial } from './ui/Tutorial';

type Screen =
  | { kind: 'menu' }
  | { kind: 'tutorial' }
  | { kind: 'local'; session: HostSession }
  | { kind: 'online'; room: OnlineRoom }
  | { kind: 'host'; room: HostRoom }
  | { kind: 'guest'; client: GuestClient; code: string };

const NAME_KEY = 'yui.name';
/** Телефон, повёрнутый горизонтально: играть так тесно, просим повернуть (то же условие в styles.css). */
const LANDSCAPE_PHONE = '(orientation: landscape) and (pointer: coarse) and (max-height: 540px)';

/** Заслонка «поверните телефон»; видна только при LANDSCAPE_PHONE (см. .rotate-note в styles.css). */
function RotateNote() {
  const t = useT();
  return (
    <div className="rotate-note" aria-live="polite">
      <svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <rect x="7" y="2.5" width="10" height="19" rx="2" />
        <path d="M11 18.5h2" strokeLinecap="round" />
        <path d="M20.5 9a7 7 0 0 0-3-4.5M17.5 2.8v1.9h1.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p>{t.rotatePhone}</p>
    </div>
  );
}
/** На Яндекс Играх сеть доступна только через свой сервер: прямое соединение
 *  между браузерами идёт через сторонний сервис, а это площадка не разрешает. */
const ONLINE_AVAILABLE = Boolean(SERVER_URL) || !IS_YANDEX;

function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? platformPlayerName();
  } catch {
    return platformPlayerName();
  }
}

function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // имя просто не запомнится
  }
}

export function App() {
  return (
    <>
      <Screens />
      <RotateNote />
    </>
  );
}

function Screens() {
  const t = useT();
  const [screen, setScreen] = useState<Screen>({ kind: 'menu' });
  const [name, setName] = useState(loadName);
  const [roomCode] = useState(() =>
    normalizeRoomCode(new URLSearchParams(location.search).get('room') ?? invitePayload()),
  );
  const playerName = name.trim() || t.defaultName;

  // Пока площадка держит игру на паузе (реклама, свёрнутое окно), боты не ходят.
  const localSession = screen.kind === 'local' ? screen.session : null;
  useEffect(() => {
    if (!localSession) return;
    return platformPause.subscribe(({ paused }) => localSession.pauseFor('platform', paused));
  }, [localSession]);

  // Пока телефон лежит горизонтально и игра закрыта заслонкой, боты тоже ждут.
  useEffect(() => {
    if (!localSession) return;
    const query = window.matchMedia(LANDSCAPE_PHONE);
    const update = () => localSession.pauseFor('rotate', query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [localSession]);

  const toMenu = () => {
    if (screen.kind === 'local') screen.session.leave();
    if (screen.kind === 'online') screen.room.leave();
    if (screen.kind === 'host') screen.room.close();
    if (screen.kind === 'guest') screen.client.leave();
    setScreen({ kind: 'menu' });
  };

  const playBots = (opponents: number, level: BotLevel) => {
    const seats: HostSeat[] = [
      { name: playerName, kind: 'local' },
      ...Array.from({ length: opponents }, (_, i): HostSeat => ({ name: botSeatName(i + 1), kind: 'bot' })),
    ];
    const session = new HostSession(seats, { botLevel: level });
    session.start();
    setScreen({ kind: 'local', session });
  };

  switch (screen.kind) {
    case 'menu':
      return (
        <Menu
          name={name}
          onNameChange={(next) => {
            setName(next);
            saveName(next);
          }}
          initialCode={roomCode}
          online={ONLINE_AVAILABLE}
          quick={Boolean(SERVER_URL)}
          onPlayBots={playBots}
          onQuick={() =>
            setScreen({ kind: 'online', room: new OnlineRoom(SERVER_URL, { quick: true, name: playerName }) })
          }
          onHost={() =>
            setScreen(
              SERVER_URL
                ? { kind: 'online', room: new OnlineRoom(SERVER_URL, { create: true, name: playerName }) }
                : { kind: 'host', room: new HostRoom(playerName) },
            )
          }
          onJoin={(code) =>
            setScreen(
              SERVER_URL
                ? { kind: 'online', room: new OnlineRoom(SERVER_URL, { code, name: playerName }) }
                : { kind: 'guest', client: new GuestClient(code, playerName), code },
            )
          }
          onTutorial={() => setScreen({ kind: 'tutorial' })}
        />
      );
    case 'tutorial':
      return <Tutorial onExit={toMenu} onPlay={() => playBots(1, 'easy')} />;
    case 'local':
      return <Table session={screen.session} onExit={toMenu} />;
    case 'online':
      return (
        <OnlineScreen
          room={screen.room}
          onExit={toMenu}
          onBots={() => {
            screen.room.leave();
            playBots(1, 'normal');
          }}
        />
      );
    case 'host':
      return <HostScreen room={screen.room} hostName={playerName} onExit={toMenu} />;
    case 'guest':
      return <GuestScreen client={screen.client} code={screen.code} onExit={toMenu} />;
  }
}
