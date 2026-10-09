import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { BotLevel } from '../src/game/bot';
import { MAX_PLAYERS, MIN_PLAYERS, Move } from '../src/game/engine';
import { HostSeat, HostSession, botSeatName } from '../src/game/session';
import {
  Activity,
  ClientMessage,
  NAME_LENGTH,
  ServerMessage,
  makeRoomCode,
  normalizeRoomCode,
} from '../src/net/protocol';
import { createGeoLookup, clientIp } from './geo';
import { Platform, analyticsIdentity, createStats, platformOf } from './stats';

// Игровой сервер: держит комнаты и сам ведёт партии, поэтому игра не зависит
// от вкладки одного из игроков. Правила — те же модули, что и в браузере.
// Плюс сбор статистики в формате админки RRaM (см. stats.ts).

export interface ServerOptions {
  port: number;
  /** на каком адресе слушать; за nginx достаточно 127.0.0.1 */
  host?: string;
  botDelayMs?: number;
  /** сколько живёт комната, в которой не осталось подключённых игроков */
  emptyRoomTtlMs?: number;
  /** файл со статистикой (JSON) */
  statsFile?: string;
  /** каталог с данными ip2country (gz) для определения стран */
  geoDir?: string;
  pulseMs?: number;
  /** быстрая игра: сколько ждать ещё соперников, когда собралось двое */
  quickStartMs?: number;
  /** через сколько мс после конца раздачи следующая начнётся сама */
  nextDealMs?: number;
}

interface Member {
  name: string;
  token: string;
  socket: WebSocket | null;
  visitorId: string;
  platform: Platform;
}

interface Room {
  code: string;
  members: Member[];
  session: HostSession | null;
  cleanup: ReturnType<typeof setTimeout> | null;
  createdAt: number;
  startedAt: number | null;
  /** комната быстрой игры: в неё попадают незнакомые игроки, стартует сама */
  quick: boolean;
  /** когда быстрая игра начнётся сама (пока собралось меньше двух — null) */
  startsAt: number | null;
  startTimer: ReturnType<typeof setTimeout> | null;
}

/** Данные соединения для диагностики и аналитики. */
interface Conn {
  ip: string;
  country: string;
  visitorId: string;
  platform: Platform;
  version: string;
  visible: boolean;
  /** чем занят вне онлайн-комнаты (сообщение presence); в онлайн-комнате главнее она */
  activity: Activity | null;
  engaged: boolean;
  connectedAt: number;
  lastSeen: number;
  room: Room | null;
  member: Member | null;
}

const ACTIVITIES: Activity[] = ['menu', 'ai', 'tutorial'];
const MAX_ROOMS = 500;
const MAX_MESSAGE_BYTES = 4096;
const PING_INTERVAL_MS = 30000;
const DEFAULT_PULSE_MS = 20000;
const DEFAULT_QUICK_START_MS = 15000;
const DEFAULT_NEXT_DEAL_MS = 12000;
/** новичку в быстрой игре — хотя бы столько, чтобы увидеть, с кем играет */
const QUICK_JOIN_GRACE_MS = 5000;

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
  /** в какой комнате и на каком месте сидит каждое соединение (для маршрутизации) */
  const seats = new Map<WebSocket, { room: Room; member: Member }>();
  /** все соединения — для диагностики и аналитики */
  const conns = new Map<WebSocket, Conn>();
  const emptyRoomTtlMs = options.emptyRoomTtlMs ?? 10 * 60 * 1000;
  const quickStartMs = options.quickStartMs ?? DEFAULT_QUICK_START_MS;

  const geo = createGeoLookup(options.geoDir ?? process.env.GEO_DIR);
  const stats = createStats(options.statsFile ?? process.env.STATS_FILE ?? `${process.cwd()}/stats.json`);

  /** режим комнаты: двое и больше людей — pvp, иначе игра против ботов */
  const roomMode = (room: Room): 'pvp' | 'ai' => (room.members.length >= 2 ? 'pvp' : 'ai');

  // ---------- админские данные в формате RRaM ----------

  const adminData = () => {
    const now = Date.now();
    const clients = [...conns.values()].map((c) => ({
      id: (c.visitorId || '').slice(0, 8) || '—',
      ip: c.ip || '?',
      version: c.version || '?',
      ua: '',
      device: '—',
      connectedSec: Math.round((now - c.connectedAt) / 1000),
      idleSec: Math.round((now - c.lastSeen) / 1000),
      rtt: null,
      state: c.room?.session ? 'в игре' : c.room ? 'лобби' : 'подключён',
      roomCode: c.room?.code ?? null,
      name: c.member?.name ?? null,
      side: null,
    }));
    clients.sort((a, b) => b.connectedSec - a.connectedSec);
    const roomList = [...rooms.values()].map((room) => {
      const snap = room.session?.snapshot();
      const players = snap
        ? snap.players.map((p) => ({ name: p.name, isBot: p.isBot && !p.away, connected: !p.isBot }))
        : room.members.map((m) => ({ name: m.name, isBot: false, connected: m.socket !== null }));
      return {
        code: room.code,
        createdAt: room.createdAt,
        startedAt: room.startedAt,
        players,
        game: snap ? { over: snap.phase === 'over' } : null,
        status: 'active',
        type: room.quick ? 'public' : 'private',
        emptySince: room.cleanup ? now : null,
      };
    });
    return {
      now,
      serverVersion: 'yui',
      uptimeSec: Math.round(process.uptime()),
      counts: {
        clients: conns.size,
        rooms: rooms.size,
        playing: roomList.filter((r) => r.game && r.players.some((p) => !p.isBot && p.connected)).length,
        saved: 0,
        waitingOnline: [...rooms.values()].filter((r) => !r.session && r.members.some((m) => m.socket))
          .length,
        waitingOffline: 0,
        lobbyWatchers: [...rooms.values()]
          .filter((r) => r.quick && !r.session)
          .reduce((n, r) => n + r.members.length, 0),
      },
      clients,
      rooms: roomList,
    };
  };

  const http = createServer((request, response) => {
    const url = request.url ?? '';
    if (url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, rooms: rooms.size }));
      return;
    }
    if (url === '/admin/data' || url.startsWith('/admin/stats')) {
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
      let body: unknown;
      if (url === '/admin/data') {
        body = adminData();
      } else {
        const q = new URL(url, 'http://localhost').searchParams;
        body = {
          ...stats.summary(q.get('days'), q.get('platform'), q.get('mode')),
          geo: { available: geo.available, updatedAt: geo.updatedAt },
        };
      }
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify(body));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const wss = new WebSocketServer({ server: http, maxPayload: MAX_MESSAGE_BYTES });

  const syncLobby = (room: Room) => {
    const names = room.members.map((m) => m.name);
    const extra = room.quick
      ? {
          quick: true,
          startsIn: room.startsAt === null ? null : Math.max(0, room.startsAt - Date.now()),
          online: conns.size,
        }
      : {};
    room.members.forEach((member, you) => send(member.socket, { t: 'lobby', names, you, owner: 0, ...extra }));
  };

  const newRoom = (quick: boolean): Room => {
    let code = makeRoomCode();
    while (rooms.has(code)) code = makeRoomCode();
    const room: Room = {
      code,
      members: [],
      session: null,
      cleanup: null,
      createdAt: Date.now(),
      startedAt: null,
      quick,
      startsAt: null,
      startTimer: null,
    };
    rooms.set(code, room);
    return room;
  };

  const cancelQuickStart = (room: Room) => {
    if (room.startTimer) clearTimeout(room.startTimer);
    room.startTimer = null;
    room.startsAt = null;
  };

  const startRoom = (room: Room, bots: number, level: BotLevel) => {
    cancelQuickStart(room);
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
      // темп сетевой игры: следующую раздачу начинает любой, а не дождётся никто — начнётся сама
      anyoneRestarts: true,
      autoNextDealMs: options.nextDealMs ?? DEFAULT_NEXT_DEAL_MS,
    });
    room.startedAt = Date.now();
    room.session.start();
    recordRoom(room);
  };

  /**
   * Быстрая игра стартует сама: стол полон — сразу; двое и больше — через
   * quickStartMs (вдруг подойдёт кто-то ещё); остался один — ждём дальше.
   */
  const scheduleQuick = (room: Room) => {
    if (!room.quick || room.session) return;
    const count = room.members.length;
    if (count >= MAX_PLAYERS) {
      startRoom(room, 0, 'normal');
      return;
    }
    if (count < MIN_PLAYERS) {
      cancelQuickStart(room);
    } else {
      const now = Date.now();
      const at = room.startsAt === null ? now + quickStartMs : Math.max(room.startsAt, now + QUICK_JOIN_GRACE_MS);
      if (at !== room.startsAt) {
        if (room.startTimer) clearTimeout(room.startTimer);
        room.startsAt = at;
        room.startTimer = setTimeout(() => {
          room.startTimer = null;
          if (!room.session && room.members.length >= MIN_PLAYERS) startRoom(room, 0, 'normal');
        }, at - now);
      }
    }
    syncLobby(room);
  };

  const syncOwner = (room: Room) => {
    const owner = room.members.findIndex((m) => m.socket !== null);
    if (owner >= 0) room.session?.setOwner(owner);
  };

  /** Записать текущую раздачу комнаты в статистику (идемпотентно). */
  const recordRoom = (room: Room, time = Date.now()) => {
    const snap = room.session?.snapshot();
    if (!snap || !snap.startedAt) return;
    stats.recordDeal({
      id: `${room.code}#${snap.dealNo}`,
      started: snap.startedAt,
      finished: snap.phase === 'over' ? time : null,
      lastActivity: time,
      mode: roomMode(room),
      participants: room.members.map((m, seat) => ({
        player: seat,
        person: analyticsIdentity(m.visitorId),
        platform: m.platform,
        actions: snap.players[seat]?.actions ?? 0,
      })),
    });
  };

  const dropRoom = (room: Room) => {
    recordRoom(room);
    if (room.cleanup) clearTimeout(room.cleanup);
    cancelQuickStart(room);
    room.session?.leave();
    room.members.forEach((member) => member.socket && seats.delete(member.socket));
    rooms.delete(room.code);
  };

  const enter = (socket: WebSocket, room: Room, name: string) => {
    const conn = conns.get(socket);
    const member: Member = {
      name,
      token: randomBytes(16).toString('hex'),
      socket,
      visitorId: conn?.visitorId ?? '',
      platform: conn?.platform ?? 'unknown',
    };
    room.members.push(member);
    seats.set(socket, { room, member });
    if (conn) {
      conn.room = room;
      conn.member = member;
    }
    send(socket, { t: 'joined', code: room.code, token: member.token });
    if (room.quick) scheduleQuick(room);
    else syncLobby(room);
  };

  /** Обновить идентификацию соединения из входящего сообщения. */
  const applyMeta = (conn: Conn | undefined, m: ClientMessage) => {
    if (!conn) return;
    if (m.t !== 'create' && m.t !== 'join' && m.t !== 'quick' && m.t !== 'rejoin' && m.t !== 'ping' && m.t !== 'presence') return;
    if (typeof m.visitorId === 'string' && m.visitorId.length <= 64) conn.visitorId = m.visitorId;
    const p = platformOf(m.platform);
    if (p !== 'unknown') conn.platform = p;
    if (typeof m.version === 'string') conn.version = m.version.slice(0, 20);
  };

  const onMessage = (socket: WebSocket, message: ClientMessage) => {
    const conn = conns.get(socket);
    if (conn) conn.lastSeen = Date.now();
    applyMeta(conn, message);

    if (message.t === 'ping') {
      const searching = [...rooms.values()]
        .filter((r) => r.quick && !r.session)
        .reduce((n, r) => n + r.members.filter((m) => m.socket).length, 0);
      // одного посетителя с несколькими соединениями (меню + присутствие) считаем один раз, себя — нет
      const me = conn?.visitorId;
      const others = new Set<unknown>();
      for (const [s, c] of conns) if (s !== socket && !(me && c.visitorId === me)) others.add(c.visitorId || s);
      return send(socket, { t: 'status', online: others.size, searching });
    }

    if (message.t === 'presence') {
      if (conn && ACTIVITIES.includes(message.activity)) {
        conn.activity = message.activity;
        conn.engaged = Boolean(message.engaged);
      }
      return;
    }

    if (message.t === 'visible') {
      if (conn) conn.visible = Boolean(message.visible);
      return;
    }

    const seat = seats.get(socket);

    if (message.t === 'create') {
      if (seat) return;
      if (rooms.size >= MAX_ROOMS) return send(socket, { t: 'error', code: 'server-full' });
      enter(socket, newRoom(false), cleanName(message.name));
      return;
    }

    if (message.t === 'quick') {
      if (seat) return;
      // самая наполненная из ждущих — так партии собираются быстрее
      let room: Room | null = null;
      for (const r of rooms.values()) {
        if (r.quick && !r.session && r.members.length < MAX_PLAYERS) {
          if (!room || r.members.length > room.members.length) room = r;
        }
      }
      if (!room) {
        if (rooms.size >= MAX_ROOMS) return send(socket, { t: 'error', code: 'server-full' });
        room = newRoom(true);
      }
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
        seats.delete(member.socket);
        member.socket.close();
      }
      member.socket = socket;
      seats.set(socket, { room, member });
      if (conn) {
        conn.room = room;
        conn.member = member;
        if (conn.visitorId) member.visitorId = conn.visitorId;
        if (conn.platform !== 'unknown') member.platform = conn.platform;
      }
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
      // быстрая игра стартует сама и только с людьми
      if (room.session || room.quick || index !== 0) return;
      const bots = Math.max(0, Math.min(Number(message.bots) || 0, MAX_PLAYERS - room.members.length));
      if (room.members.length + bots < MIN_PLAYERS) return;
      startRoom(room, bots, message.level === 'easy' ? 'easy' : 'normal');
    } else if (message.t === 'move') {
      const move = parseMove(message.move);
      if (move) {
        room.session?.handleMove(index, move);
        recordRoom(room);
      }
    } else if (message.t === 'resign') {
      room.session?.handleResign(index);
      recordRoom(room);
    } else if (message.t === 'newDeal') {
      room.session?.requestNewDeal(index);
      recordRoom(room);
    }
  };

  const onClose = (socket: WebSocket) => {
    conns.delete(socket);
    const seat = seats.get(socket);
    if (!seat) return;
    seats.delete(socket);
    const { room, member } = seat;

    if (!room.session) {
      room.members.splice(room.members.indexOf(member), 1);
      if (room.members.length === 0) dropRoom(room);
      else if (room.quick) scheduleQuick(room);
      else syncLobby(room);
      return;
    }

    member.socket = null;
    room.session.detach(room.members.indexOf(member));
    if (room.members.some((m) => m.socket !== null)) {
      syncOwner(room);
    } else {
      room.cleanup = setTimeout(() => dropRoom(room), emptyRoomTtlMs);
    }
  };

  const alive = new WeakSet<WebSocket>();
  wss.on('connection', (socket, request) => {
    const remote = request.socket.remoteAddress ?? '';
    const xReal = request.headers['x-real-ip'];
    const ip = clientIp(remote, Array.isArray(xReal) ? xReal[0] : xReal);
    const now = Date.now();
    conns.set(socket, {
      ip,
      country: geo.lookup(ip),
      visitorId: '',
      platform: 'unknown',
      version: '',
      visible: true,
      activity: null,
      engaged: false,
      connectedAt: now,
      lastSeen: now,
      room: null,
      member: null,
    });
    alive.add(socket);
    socket.on('pong', () => {
      alive.add(socket);
      const c = conns.get(socket);
      if (c) c.lastSeen = Date.now();
    });
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

  const pinger = setInterval(() => {
    wss.clients.forEach((socket) => {
      if (!alive.has(socket)) return socket.terminate();
      alive.delete(socket);
      socket.ping();
    });
  }, PING_INTERVAL_MS);

  // Пульс аналитики: учёт времени/посетителей и дозапись идущих партий.
  const pulse = setInterval(() => {
    const time = Date.now();
    const items = [];
    for (const conn of conns.values()) {
      const identity = analyticsIdentity(conn.visitorId);
      if (!identity) continue;
      let playing = false;
      let engaged = false;
      let mode: 'pvp' | 'ai' | 'tutorial' = 'pvp';
      if (!conn.room && (conn.activity === 'ai' || conn.activity === 'tutorial')) {
        // игра с ботами и обучение идут в браузере, сервер знает о них только из presence
        mode = conn.activity;
        playing = true;
        engaged = conn.engaged;
      } else if (conn.room?.session && conn.member) {
        const snap = conn.room.session.snapshot();
        const seat = conn.room.members.indexOf(conn.member);
        const me = snap.players[seat];
        mode = roomMode(conn.room);
        playing = snap.phase === 'playing' && !!me && me.place === null;
        engaged = !!me && me.actions > 0;
      }
      items.push({
        identity,
        platform: conn.platform,
        country: conn.country,
        visible: conn.visible,
        lastSeen: conn.lastSeen,
        playing,
        mode,
        engaged,
      });
    }
    stats.pulse(items, time);
    for (const room of rooms.values()) if (room.session) recordRoom(room, time);
  }, options.pulseMs ?? DEFAULT_PULSE_MS);
  if (typeof pulse.unref === 'function') pulse.unref();

  http.listen(options.port, options.host);

  return {
    http,
    close: () =>
      new Promise((resolve) => {
        clearInterval(pinger);
        clearInterval(pulse);
        [...rooms.values()].forEach(dropRoom);
        stats.flush();
        stats.stop();
        wss.clients.forEach((socket) => socket.terminate());
        wss.close(() => http.close(() => resolve()));
      }),
  };
}
