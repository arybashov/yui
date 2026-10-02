import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { BotLevel } from '../src/game/bot';
import { MAX_PLAYERS, MIN_PLAYERS, Move } from '../src/game/engine';
import { HostSeat, HostSession, botSeatName } from '../src/game/session';
import {
  ClientMessage,
  NAME_LENGTH,
  ServerMessage,
  makeRoomCode,
  normalizeRoomCode,
} from '../src/net/protocol';

// Игровой сервер: держит комнаты и сам ведёт партии, поэтому игра не зависит
// от вкладки одного из игроков. Правила — те же модули, что и в браузере.

export interface ServerOptions {
  port: number;
  /** на каком адресе слушать; за nginx достаточно 127.0.0.1 */
  host?: string;
  botDelayMs?: number;
  /** сколько живёт комната, в которой не осталось подключённых игроков */
  emptyRoomTtlMs?: number;
}

interface Member {
  name: string;
  token: string;
  socket: WebSocket | null;
}

interface Room {
  code: string;
  members: Member[];
  session: HostSession | null;
  cleanup: ReturnType<typeof setTimeout> | null;
}

const MAX_ROOMS = 500;
const MAX_MESSAGE_BYTES = 4096;
const PING_INTERVAL_MS = 30000;

// Админ-данные отдаются под тем же логином/паролем, что админка RRaM, — чтобы
// не плодить отдельную учётку. Без ADMIN_PASSWORD эндпоинт закрыт (503).
const ADMIN_USER = process.env.ADMIN_USER ?? 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function adminAuthorized(header: string | undefined): boolean {
  if (!ADMIN_PASSWORD) return false;
  const m = /^Basic\s+(.+)$/i.exec(header ?? '');
  if (!m) return false;
  const dec = Buffer.from(m[1], 'base64').toString('utf8');
  const i = dec.indexOf(':');
  return i >= 0 && safeEqual(dec.slice(0, i), ADMIN_USER) && safeEqual(dec.slice(i + 1), ADMIN_PASSWORD);
}

function send(socket: WebSocket | null, message: ServerMessage): void {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function cleanName(raw: unknown): string {
  return String(raw ?? '').trim().slice(0, NAME_LENGTH) || 'Player';
}

function parseMove(raw: unknown): Move | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const move = raw as { type?: unknown; cards?: unknown };
  if (move.type === 'take') return { type: 'take' };
  if (
    move.type === 'play' &&
    Array.isArray(move.cards) &&
    move.cards.length >= 1 &&
    move.cards.length <= 4 &&
    move.cards.every((id) => typeof id === 'string')
  ) {
    return { type: 'play', cards: move.cards as string[] };
  }
  return null;
}

export function startServer(options: ServerOptions): { http: Server; close: () => Promise<void> } {
  const rooms = new Map<string, Room>();
  /** в какой комнате и на каком месте сидит каждое соединение */
  const seats = new Map<WebSocket, { room: Room; member: Member }>();
  const emptyRoomTtlMs = options.emptyRoomTtlMs ?? 10 * 60 * 1000;

  // Сводка для админки: комнаты, игроки, идёт ли партия. Без чужих личных данных
  // и без карт на руках — только то, что нужно для диагностики.
  const adminData = () => ({
    game: 'yui',
    now: Date.now(),
    uptimeSec: Math.round(process.uptime()),
    counts: {
      rooms: rooms.size,
      connections: seats.size,
      playing: [...rooms.values()].filter((r) => r.session).length,
      lobby: [...rooms.values()].filter((r) => !r.session).length,
    },
    rooms: [...rooms.values()].map((room) => ({
      code: room.code,
      started: Boolean(room.session),
      members: room.members.map((m) => ({ name: m.name, connected: m.socket !== null })),
      game: room.session?.snapshot() ?? null,
    })),
  });

  const http = createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, rooms: rooms.size }));
      return;
    }
    if (request.url === '/admin/data') {
      if (!ADMIN_PASSWORD) {
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'admin_not_configured' }));
        return;
      }
      if (!adminAuthorized(request.headers.authorization)) {
        response.writeHead(401, { 'www-authenticate': 'Basic realm="yui"' });
        response.end();
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify(adminData()));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const wss = new WebSocketServer({ server: http, maxPayload: MAX_MESSAGE_BYTES });

  const syncLobby = (room: Room) => {
    const names = room.members.map((m) => m.name);
    room.members.forEach((member, you) => send(member.socket, { t: 'lobby', names, you, owner: 0 }));
  };

  /** Владелец партии — первый игрок, у которого есть связь: он запускает новые раздачи. */
  const syncOwner = (room: Room) => {
    const owner = room.members.findIndex((m) => m.socket !== null);
    if (owner >= 0) room.session?.setOwner(owner);
  };

  const dropRoom = (room: Room) => {
    if (room.cleanup) clearTimeout(room.cleanup);
    room.session?.leave();
    room.members.forEach((member) => member.socket && seats.delete(member.socket));
    rooms.delete(room.code);
  };

  const enter = (socket: WebSocket, room: Room, name: string) => {
    const member: Member = { name, token: randomBytes(16).toString('hex'), socket };
    room.members.push(member);
    seats.set(socket, { room, member });
    send(socket, { t: 'joined', code: room.code, token: member.token });
    syncLobby(room);
  };

  const onMessage = (socket: WebSocket, message: ClientMessage) => {
    const seat = seats.get(socket);

    if (message.t === 'create') {
      if (seat) return;
      if (rooms.size >= MAX_ROOMS) return send(socket, { t: 'error', code: 'server-full' });
      let code = makeRoomCode();
      while (rooms.has(code)) code = makeRoomCode();
      const room: Room = { code, members: [], session: null, cleanup: null };
      rooms.set(code, room);
      enter(socket, room, cleanName(message.name));
      return;
    }

    if (message.t === 'join') {
      if (seat) return;
      const room = rooms.get(normalizeRoomCode(String(message.code ?? '')));
      if (!room) return send(socket, { t: 'error', code: 'room-not-found' });
      if (room.session) return send(socket, { t: 'error', code: 'game-started' });
      if (room.members.length >= MAX_PLAYERS) return send(socket, { t: 'error', code: 'room-full' });
      enter(socket, room, cleanName(message.name));
      return;
    }

    if (message.t === 'rejoin') {
      if (seat) return;
      const room = rooms.get(normalizeRoomCode(String(message.code ?? '')));
      const index = room ? room.members.findIndex((m) => m.token === message.token) : -1;
      if (!room || !room.session || index < 0) {
        return send(socket, { t: 'error', code: 'game-over' });
      }
      const member = room.members[index];
      if (member.socket) {
        // прежнее соединение ещё не закрылось — заменяем его новым
        seats.delete(member.socket);
        member.socket.close();
      }
      member.socket = socket;
      seats.set(socket, { room, member });
      if (room.cleanup) clearTimeout(room.cleanup);
      room.cleanup = null;
      send(socket, { t: 'joined', code: room.code, token: member.token });
      room.session.attach(index, (view) => send(member.socket, { t: 'view', view }));
      syncOwner(room);
      return;
    }

    if (!seat) return;
    const { room, member } = seat;
    const index = room.members.indexOf(member);

    if (message.t === 'start') {
      if (room.session || index !== 0) return;
      const bots = Math.max(0, Math.min(Number(message.bots) || 0, MAX_PLAYERS - room.members.length));
      if (room.members.length + bots < MIN_PLAYERS) return;
      const level: BotLevel = message.level === 'easy' ? 'easy' : 'normal';
      const hostSeats: HostSeat[] = [
        ...room.members.map(
          (m): HostSeat => ({
            name: m.name,
            kind: 'remote',
            send: (view) => send(m.socket, { t: 'view', view }),
          }),
        ),
        ...Array.from({ length: bots }, (_, i): HostSeat => ({ name: botSeatName(i + 1), kind: 'bot' })),
      ];
      room.session = new HostSession(hostSeats, {
        botLevel: level,
        botDelayMs: options.botDelayMs,
        ownerSeat: 0,
      });
      room.session.start();
    } else if (message.t === 'move') {
      const move = parseMove(message.move);
      if (move) room.session?.handleMove(index, move);
    } else if (message.t === 'newDeal') {
      room.session?.requestNewDeal(index);
    }
  };

  const onClose = (socket: WebSocket) => {
    const seat = seats.get(socket);
    if (!seat) return;
    seats.delete(socket);
    const { room, member } = seat;

    if (!room.session) {
      // в лобби место просто освобождается
      room.members.splice(room.members.indexOf(member), 1);
      if (room.members.length === 0) dropRoom(room);
      else syncLobby(room);
      return;
    }

    // в партии за игрока доигрывает бот, а место ждёт его возвращения
    member.socket = null;
    room.session.detach(room.members.indexOf(member));
    if (room.members.some((m) => m.socket !== null)) {
      syncOwner(room);
    } else {
      room.cleanup = setTimeout(() => dropRoom(room), emptyRoomTtlMs);
    }
  };

  const alive = new WeakSet<WebSocket>();
  wss.on('connection', (socket) => {
    alive.add(socket);
    socket.on('pong', () => alive.add(socket));
    socket.on('message', (data) => {
      try {
        onMessage(socket, JSON.parse(String(data)) as ClientMessage);
      } catch {
        send(socket, { t: 'error', code: 'bad-message' });
      }
    });
    socket.on('close', () => onClose(socket));
    socket.on('error', () => socket.terminate());
  });

  // закрываем соединения, которые перестали отвечать: иначе место «зависает»
  const pinger = setInterval(() => {
    wss.clients.forEach((socket) => {
      if (!alive.has(socket)) return socket.terminate();
      alive.delete(socket);
      socket.ping();
    });
  }, PING_INTERVAL_MS);

  http.listen(options.port, options.host);

  return {
    http,
    close: () =>
      new Promise((resolve) => {
        clearInterval(pinger);
        [...rooms.values()].forEach(dropRoom);
        wss.clients.forEach((socket) => socket.terminate());
        wss.close(() => http.close(() => resolve()));
      }),
  };
}
