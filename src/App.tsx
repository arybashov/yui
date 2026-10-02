import { useState } from 'react';
import { BotLevel } from './game/bot';
import { HostSeat, HostSession } from './game/session';
import { GuestClient, HostRoom, normalizeRoomCode } from './net/room';
import { Menu } from './ui/Menu';
import { GuestScreen, HostScreen } from './ui/Online';
import { Table } from './ui/Table';
import { Tutorial } from './ui/Tutorial';

type Screen =
  | { kind: 'menu' }
  | { kind: 'tutorial' }
  | { kind: 'local'; session: HostSession }
  | { kind: 'host'; room: HostRoom }
  | { kind: 'guest'; client: GuestClient };

const NAME_KEY = 'yui.name';

function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
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
  const [screen, setScreen] = useState<Screen>({ kind: 'menu' });
  const [name, setName] = useState(loadName);
  const [roomCode] = useState(() =>
    normalizeRoomCode(new URLSearchParams(location.search).get('room') ?? ''),
  );
  const playerName = name.trim() || 'Игрок';

  const toMenu = () => {
    if (screen.kind === 'local') screen.session.leave();
    if (screen.kind === 'host') screen.room.close();
    if (screen.kind === 'guest') screen.client.leave();
    setScreen({ kind: 'menu' });
  };

  const playBots = (opponents: number, level: BotLevel) => {
    const seats: HostSeat[] = [
      { name: playerName, kind: 'local' },
      ...Array.from({ length: opponents }, (_, i): HostSeat => ({ name: `Бот ${i + 1}`, kind: 'bot' })),
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
          onPlayBots={playBots}
          onHost={() => setScreen({ kind: 'host', room: new HostRoom(playerName) })}
          onJoin={(code) => setScreen({ kind: 'guest', client: new GuestClient(code, playerName) })}
          onTutorial={() => setScreen({ kind: 'tutorial' })}
        />
      );
    case 'tutorial':
      return <Tutorial onExit={toMenu} onPlay={() => playBots(1, 'easy')} />;
    case 'local':
      return <Table session={screen.session} onExit={toMenu} />;
    case 'host':
      return <HostScreen room={screen.room} hostName={playerName} onExit={toMenu} />;
    case 'guest':
      return <GuestScreen client={screen.client} onExit={toMenu} />;
  }
}
