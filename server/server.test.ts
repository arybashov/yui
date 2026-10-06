import { once } from 'node:events';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { PlayerView } from '../src/game/session';
import { ClientMessage, ServerMessage } from '../src/net/protocol';
import { startServer } from './server';

type Running = ReturnType<typeof startServer>;

/** Тестовый игрок: копит сообщения сервера и умеет ждать нужное. */
class Player {
  private inbox: ServerMessage[] = [];
  private waiters: (() => void)[] = [];
  readonly socket: WebSocket;

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.on('message', (data) => {
      this.inbox.push(JSON.parse(String(data)) as ServerMessage);
      this.waiters.splice(0).forEach((wake) => wake());
    });
  }

  async open(): Promise<this> {
    await once(this.socket, 'open');
    return this;
  }

  send(message: ClientMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  /** Ждёт первое ещё не прочитанное сообщение, подходящее под условие. */
  async next<T extends ServerMessage['t']>(
    type: T,
    match: (message: Extract<ServerMessage, { t: T }>) => boolean = () => true,
  ): Promise<Extract<ServerMessage, { t: T }>> {
    const deadline = Date.now() + 3000;
    for (;;) {
      const index = this.inbox.findIndex(
        (m) => m.t === type && match(m as Extract<ServerMessage, { t: T }>),
      );
      if (index >= 0) return this.inbox.splice(0, index + 1)[index] as Extract<ServerMessage, { t: T }>;
      if (Date.now() > deadline) throw new Error(`не дождались сообщения ${type}`);
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 100);
      });
    }
  }

  view(match: (view: PlayerView) => boolean = () => true): Promise<PlayerView> {
    return this.next('view', (m) => match(m.view)).then((m) => m.view);
  }
}

describe('игровой сервер', () => {
  let server: Running;
  let url: string;
  const players: Player[] = [];

  const connect = async () => {
    const player = await new Player(url).open();
    players.push(player);
    return player;
  };

  /** Комната из двух игроков, игра начата. */
  const startedRoom = async (bots = 0) => {
    const anna = await connect();
    anna.send({ t: 'create', name: 'Анна' });
    const { code } = await anna.next('joined');
    const boris = await connect();
    boris.send({ t: 'join', code, name: 'Борис' });
    const borisJoined = await boris.next('joined');
    await anna.next('lobby', (m) => m.names.length === 2);
    anna.send({ t: 'start', bots, level: 'normal' });
    return { anna, boris, code, borisToken: borisJoined.token };
  };

  beforeEach(async () => {
    server = startServer({
      port: 0,
      botDelayMs: 5,
      emptyRoomTtlMs: 50,
      quickStartMs: 200,
      statsFile: join(tmpdir(), `yui-stats-${process.pid}-${Date.now()}.json`),
    });
    await once(server.http, 'listening');
    url = `ws://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    players.splice(0).forEach((player) => player.socket.terminate());
    await server.close();
  });

  it('создаёт комнату и пускает в неё по коду', async () => {
    const anna = await connect();
    anna.send({ t: 'create', name: 'Анна' });
    const { code } = await anna.next('joined');
    expect(code).toMatch(/^[A-Z0-9]{5}$/);

    const boris = await connect();
    boris.send({ t: 'join', code: code.toLowerCase(), name: 'Борис' });
    const lobby = await boris.next('lobby');
    expect(lobby.names).toEqual(['Анна', 'Борис']);
    expect(lobby.you).toBe(1);
    expect(lobby.owner).toBe(0);
  });

  it('не пускает в несуществующую комнату', async () => {
    const player = await connect();
    player.send({ t: 'join', code: 'ZZZZZ', name: 'Кто-то' });
    expect((await player.next('error')).code).toBe('room-not-found');
  });

  it('начать игру может только создатель', async () => {
    const anna = await connect();
    anna.send({ t: 'create', name: 'Анна' });
    const { code } = await anna.next('joined');
    const boris = await connect();
    boris.send({ t: 'join', code, name: 'Борис' });
    await boris.next('lobby');

    boris.send({ t: 'start', bots: 0, level: 'normal' });
    anna.send({ t: 'start', bots: 0, level: 'normal' });
    const view = await boris.view();
    expect(view.players.map((p) => p.name)).toEqual(['Анна', 'Борис']);
    expect(view.canRestart).toBe(false);
  });

  it('раздаёт карты и принимает ход только от того, чей он', async () => {
    const { anna, boris } = await startedRoom();
    const [a, b] = [await anna.view(), await boris.view()];
    expect(a.hand.length + b.hand.length).toBe(20);
    expect(a.hand.some((card) => b.hand.some((other) => other.id === card.id))).toBe(false);

    const [first, second] = a.turn === 0 ? [anna, boris] : [boris, anna];
    second.send({ t: 'move', move: { type: 'play', cards: ['10S'] } });
    first.send({ t: 'move', move: { type: 'play', cards: ['10S'] } });
    const after = await second.view((view) => view.pile.length > 0);
    expect(after.pile.map((card) => card.id)).toEqual(['10S']);
    expect(after.turn).toBe(a.turn === 0 ? 1 : 0);
    expect(after.moveNo).toBe(1);
  });

  it('сломанное сообщение не роняет сервер', async () => {
    const { anna } = await startedRoom();
    await anna.view();
    anna.socket.send('это не json');
    expect((await anna.next('error')).code).toBe('bad-message');
    anna.send({ t: 'move', move: { type: 'play', cards: 'все' } } as unknown as ClientMessage);
    anna.send({ t: 'newDeal' });
    // соединение живо, партия продолжается
    expect(anna.socket.readyState).toBe(WebSocket.OPEN);
  });

  it('за отключившегося доигрывает бот, а вернувшийся получает своё место', async () => {
    const { anna, boris, code, borisToken } = await startedRoom();
    await anna.view();
    boris.socket.close();

    const away = await anna.view((view) => view.players[1].isBot);
    expect(away.players[1].away).toBe(true);
    expect(away.players[1].name).toBe('Борис');

    const back = await connect();
    back.send({ t: 'rejoin', code, token: borisToken });
    const mine = await back.view();
    expect(mine.seat).toBe(1);
    const restored = await anna.view((view) => !view.players[1].isBot);
    expect(restored.players[1].away).toBe(false);
  });

  it('когда создатель отключился, новые раздачи запускает другой игрок', async () => {
    const { anna, boris } = await startedRoom();
    await boris.view();
    anna.socket.close();
    const view = await boris.view((v) => v.canRestart);
    expect(view.players[0].isBot).toBe(true);
  });

  it('боты на сервере ходят сами', async () => {
    const anna = await connect();
    anna.send({ t: 'create', name: 'Анна' });
    await anna.next('joined');
    anna.send({ t: 'start', bots: 1, level: 'normal' });
    const first = await anna.view();
    if (first.turn === 0) anna.send({ t: 'move', move: { type: 'play', cards: ['10S'] } });
    // ход бота виден по тому, что очередь снова дошла до игрока
    const later = await anna.view((view) => view.turn === 0 && view.moveNo >= 1 && view.pile.length > 0);
    expect(later.players[1].name).toBe('Bot 1');
    expect(later.log.some((entry) => entry.player === 1)).toBe(true);
  });

  it('возврат с чужим ключом не проходит', async () => {
    const { anna, code } = await startedRoom();
    await anna.view();
    const stranger = await connect();
    stranger.send({ t: 'rejoin', code, token: 'не тот ключ' });
    expect((await stranger.next('error')).code).toBe('game-over');
  });

  it('отвечает меню, что жив, и сколько людей ищут соперника', async () => {
    const anna = await connect();
    anna.send({ t: 'quick', name: 'Анна' });
    await anna.next('lobby');
    const menu = await connect();
    menu.send({ t: 'ping' });
    const status = await menu.next('status');
    expect(status.online).toBe(1);
    expect(status.searching).toBe(1);
  });

  it('быстрая игра сводит незнакомых игроков и стартует сама, без ботов', async () => {
    const anna = await connect();
    anna.send({ t: 'quick', name: 'Анна' });
    const alone = await anna.next('lobby');
    expect(alone.quick).toBe(true);
    expect(alone.startsIn).toBeNull();

    const boris = await connect();
    boris.send({ t: 'quick', name: 'Борис' });
    const lobby = await boris.next('lobby', (m) => m.names.length === 2);
    expect(lobby.names).toEqual(['Анна', 'Борис']);
    expect(lobby.startsIn).toBeGreaterThan(0);
    // кнопки «Начать» в быстрой игре нет — сервер стартует сам
    anna.send({ t: 'start', bots: 3, level: 'normal' });

    const view = await boris.view();
    expect(view.players.map((p) => p.name)).toEqual(['Анна', 'Борис']);
    expect(view.players.every((p) => !p.isBot)).toBe(true);
  });

  it('в быструю игру не попадают чужие комнаты по коду и начатые партии', async () => {
    const { anna } = await startedRoom();
    await anna.view();
    const friend = await connect();
    friend.send({ t: 'create', name: 'Друг' });
    await friend.next('joined');

    const vera = await connect();
    vera.send({ t: 'quick', name: 'Вера' });
    const lobby = await vera.next('lobby');
    expect(lobby.names).toEqual(['Вера']);
  });

  it('если соперник ушёл из быстрой игры до старта, отсчёт отменяется', async () => {
    const anna = await connect();
    anna.send({ t: 'quick', name: 'Анна' });
    await anna.next('lobby');
    const boris = await connect();
    boris.send({ t: 'quick', name: 'Борис' });
    await anna.next('lobby', (m) => m.names.length === 2);
    boris.socket.close();
    const back = await anna.next('lobby', (m) => m.names.length === 1);
    expect(back.startsIn).toBeNull();
    // и следующий ищущий попадает к Анне, а не в новую комнату
    const vera = await connect();
    vera.send({ t: 'quick', name: 'Вера' });
    expect((await vera.next('lobby')).names).toEqual(['Анна', 'Вера']);
  });
});
