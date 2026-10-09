import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { chooseMove } from '../src/game/bot';
import { PlayerView } from '../src/game/session';
import { ClientMessage, ServerMessage } from '../src/net/protocol';
import { startServer } from './server';
import { signInitData } from './test-telegram';

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
      nextDealMs: 300,
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
    // а вот следующую раздачу в сетевой игре может начать любой — чтобы не терять темп
    expect(view.canRestart).toBe(true);
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

  it('после раздачи следующая начинается сама, без создателя', async () => {
    const { anna, boris } = await startedRoom();
    // оба играют «как боты», пока раздача не кончится
    const players = [anna, boris];
    let view = await anna.view();
    for (let i = 0; i < 2000 && view.phase === 'playing'; i++) {
      const mover = players[view.turn];
      // вид Анны уже прочитан в цикле, вид Бориса для этого же хода — берём из его очереди
      const mine = mover === anna ? view : await boris.view((v) => v.moveNo === view.moveNo);
      mover.send({ t: 'move', move: chooseMove(mine.hand, mine.pile, 'normal') });
      view = await anna.view((v) => v.moveNo > view.moveNo || v.phase === 'over');
    }
    const over = await boris.view((v) => v.phase === 'over');
    expect(over.nextDealIn).toBeGreaterThan(0);
    const next = await boris.view((v) => v.dealNo === 2);
    expect(next.phase).toBe('playing');
  });

  it('сдаться: раздача кончается, а следующая в той же комнате начинается сама', async () => {
    const { anna, boris } = await startedRoom();
    await boris.view();
    boris.send({ t: 'resign' });
    const over = await anna.view((v) => v.phase === 'over');
    expect(over.loser).toBe(1);
    expect(over.players[1].losses).toBe(1);
    const next = await anna.view((v) => v.dealNo === 2);
    expect(next.phase).toBe('playing');
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

describe('присутствие вне онлайна', () => {
  const meta = { visitorId: 'visitor-telegram-1', platform: 'telegram', version: 'test' };

  it('игра с ботами и меню попадают в статистику с площадкой и режимом', async () => {
    const statsFile = join(tmpdir(), `yui-presence-${process.pid}-${Date.now()}.json`);
    const server = startServer({ port: 0, pulseMs: 30, statsFile });
    await once(server.http, 'listening');
    const player = await new Player(`ws://127.0.0.1:${(server.http.address() as AddressInfo).port}`).open();
    player.send({ t: 'presence', activity: 'ai', engaged: true, ...meta });
    await new Promise((resolve) => setTimeout(resolve, 150));
    player.socket.terminate();
    await server.close();
    const rows = JSON.parse(readFileSync(statsFile, 'utf8')).daily;
    expect(rows).toContainEqual(expect.objectContaining({ platform: 'telegram', mode: 'ai', played: 1 }));
  });

  it('«сейчас онлайн» не считает самого спрашивающего и его второе соединение', async () => {
    const server = startServer({ port: 0, statsFile: join(tmpdir(), `yui-online-${process.pid}-${Date.now()}.json`) });
    await once(server.http, 'listening');
    const url = `ws://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
    const presence = await new Player(url).open();
    presence.send({ t: 'presence', activity: 'menu', ...meta });
    const other = await new Player(url).open();
    other.send({ t: 'presence', activity: 'menu', ...meta, visitorId: 'visitor-someone-else' });
    const menu = await new Player(url).open();
    await new Promise((resolve) => setTimeout(resolve, 50));
    menu.send({ t: 'ping', ...meta });
    expect((await menu.next('status')).online).toBe(1);
    [presence, other, menu].forEach((p) => p.socket.terminate());
    await server.close();
  });
});

describe('поддержка в Telegram', () => {
  it('поддержавшему — звёздочка за столом, счёт — ссылкой от бота', async () => {
    const token = '123456:test-token-for-signatures';
    const supporters = new Set<number>([7]);
    const relay = {
      enabled: true,
      isSupporter: async (id: number) => supporters.has(id),
      invoice: async (id: number, amount: number) => `https://t.me/$invoice-${id}-${amount}`,
      summary: async () => null,
      notifyStatus: async () => false,
      setNotify: async (_id: number, on: boolean) => on,
      announce: async () => undefined,
    };
    const server = startServer({
      port: 0,
      statsFile: join(tmpdir(), `yui-support-${process.pid}-${Date.now()}.json`),
      telegramBotToken: token,
      botRelay: relay,
    });
    await once(server.http, 'listening');
    const url = `ws://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
    const initData = (id: number) =>
      signInitData({ user: JSON.stringify({ id, first_name: 'T', language_code: 'ru' }), auth_date: String(Math.floor(Date.now() / 1000)) }, token);

    const anna = await new Player(url).open();
    anna.send({ t: 'create', name: 'Анна', visitorId: 'visitor-anna-0001', tgInitData: initData(7) });
    const { code } = await anna.next('joined');
    expect((await anna.next('supporter')).supporter).toBe(true);
    const boris = await new Player(url).open();
    boris.send({ t: 'join', code, name: 'Борис', tgInitData: initData(8) });
    await anna.next('lobby', (m) => m.names.length === 2);
    anna.send({ t: 'start', bots: 0, level: 'normal' });
    const view = await boris.view();
    expect(view.players.map((p) => Boolean(p.supporter))).toEqual([true, false]);

    boris.send({ t: 'invoice', amount: 150 });
    expect((await boris.next('invoice')).link).toBe('https://t.me/$invoice-8-150');
    // после оплаты бот уже знает о поддержке: звёздочка появляется прямо за столом
    supporters.add(8);
    boris.send({ t: 'supporterCheck' });
    expect((await boris.next('supporter')).supporter).toBe(true);
    const updated = await anna.view((v) => Boolean(v.players[1].supporter));
    expect(updated.players[1].supporter).toBe(true);

    // без подписи Telegram счёт не выставляется
    const stranger = await new Player(url).open();
    stranger.send({ t: 'invoice', amount: 50 });
    expect((await stranger.next('invoice')).link).toBeNull();
    [anna, boris, stranger].forEach((p) => p.socket.terminate());
    await server.close();
  });
});

describe('уведомление «ищут соперника»', () => {
  it('подписка включается, а одинокий ждущий зовёт подписчиков не чаще ограничения', async () => {
    const token = '123456:test-token-for-signatures';
    const subscribed = new Set<number>();
    const announces: number[][] = [];
    const relay = {
      enabled: true,
      isSupporter: async () => false,
      invoice: async () => null,
      summary: async () => null,
      notifyStatus: async (id: number) => subscribed.has(id),
      setNotify: async (id: number, on: boolean) => {
        if (on) subscribed.add(id);
        else subscribed.delete(id);
        return on;
      },
      announce: async (exclude: number[]) => void announces.push(exclude),
    };
    const server = startServer({
      port: 0,
      statsFile: join(tmpdir(), `yui-notify-${process.pid}-${Date.now()}.json`),
      telegramBotToken: token,
      botRelay: relay,
      quickStartMs: 5000,
      announceEveryMs: 60000,
    });
    await once(server.http, 'listening');
    const url = `ws://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
    const initData = signInitData({ user: JSON.stringify({ id: 5, first_name: 'T' }), auth_date: String(Math.floor(Date.now() / 1000)) }, token);

    const tg = await new Player(url).open();
    tg.send({ t: 'presence', activity: 'menu', visitorId: 'visitor-tg-00005', tgInitData: initData });
    expect((await tg.next('notify')).on).toBe(false);
    tg.send({ t: 'notifySet', on: true });
    expect((await tg.next('notify')).on).toBe(true);
    expect(subscribed.has(5)).toBe(true);

    // один ждёт соперника — зовём подписчиков, но не того, кто сам сейчас в игре
    const anna = await new Player(url).open();
    anna.send({ t: 'quick', name: 'Анна' });
    await anna.next('lobby');
    expect(announces).toEqual([[5]]);
    // второй ждущий в течение ограничения рассылку не повторяет
    anna.socket.terminate();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const boris = await new Player(url).open();
    boris.send({ t: 'quick', name: 'Борис' });
    await boris.next('lobby');
    expect(announces).toHaveLength(1);

    tg.send({ t: 'notifySet', on: false });
    expect((await tg.next('notify')).on).toBe(false);
    [tg, boris].forEach((p) => p.socket.terminate());
    await server.close();
  });
});
