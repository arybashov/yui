import Peer, { DataConnection } from 'peerjs';
import { BotLevel } from '../game/bot';
import { MAX_PLAYERS, Move } from '../game/engine';
import { HostSeat, HostSession, PlayerView, Session, botSeatName } from '../game/session';
import { NetError } from '../i18n/types';
import { Store } from '../store';
import { makeRoomCode } from './protocol';

// Сеть работает напрямую между браузерами (WebRTC через PeerJS).
// Партию ведёт хост: гости присылают ходы и получают свой вид стола.

const ROOM_PREFIX = 'yui-room-';
const CONNECT_TIMEOUT_MS = 15000;

type HostMessage =
  | { t: 'lobby'; names: string[]; you: number }
  | { t: 'view'; view: PlayerView }
  | { t: 'reject'; reason: NetError };

type GuestMessage = { t: 'hello'; name: string } | { t: 'move'; move: Move };

export interface HostRoomState {
  status: 'opening' | 'open' | 'error';
  code: string;
  guests: string[];
  error?: NetError;
}

export class HostRoom {
  readonly state: Store<HostRoomState>;
  session: HostSession | null = null;
  private peer: Peer | null = null;
  private guests: { name: string; conn: DataConnection }[] = [];
  private retries = 0;

  constructor(private hostName: string) {
    this.state = new Store<HostRoomState>({ status: 'opening', code: makeRoomCode(), guests: [] });
    this.open();
  }

  private open(): void {
    const peer = new Peer(ROOM_PREFIX + this.state.get().code);
    this.peer = peer;
    peer.on('open', () => this.state.set({ status: 'open' }));
    peer.on('connection', (conn) => {
      conn.on('data', (data) => this.onMessage(conn, data as GuestMessage));
      conn.on('close', () => this.onGuestGone(conn));
    });
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id' && this.retries++ < 3) {
        // код комнаты уже занят — пробуем другой
        peer.destroy();
        this.state.set({ code: makeRoomCode() });
        this.open();
        return;
      }
      // ошибки отдельных соединений комнату не закрывают
      if (this.state.get().status === 'opening') {
        this.state.set({ status: 'error', error: 'cant-create' });
      }
    });
  }

  private onMessage(conn: DataConnection, message: GuestMessage): void {
    if (message.t === 'hello') {
      if (this.session) return this.reject(conn, 'game-started');
      if (this.guests.length >= MAX_PLAYERS - 1) return this.reject(conn, 'room-full');
      if (this.guests.some((g) => g.conn === conn)) return;
      const name = String(message.name).trim().slice(0, 16) || 'Player';
      this.guests.push({ name, conn });
      this.syncLobby();
    } else if (message.t === 'move' && this.session) {
      const index = this.guests.findIndex((g) => g.conn === conn);
      if (index >= 0) this.session.handleMove(index + 1, message.move);
    }
  }

  private reject(conn: DataConnection, reason: NetError): void {
    conn.send({ t: 'reject', reason } satisfies HostMessage);
  }

  private onGuestGone(conn: DataConnection): void {
    const index = this.guests.findIndex((g) => g.conn === conn);
    if (index < 0) return;
    if (this.session) {
      // места уже розданы: список не сдвигаем, за игрока доигрывает бот
      this.session.detach(index + 1);
    } else {
      this.guests.splice(index, 1);
      this.syncLobby();
    }
  }

  private syncLobby(): void {
    const names = [this.hostName, ...this.guests.map((g) => g.name)];
    this.guests.forEach((g, i) => {
      g.conn.send({ t: 'lobby', names, you: i + 1 } satisfies HostMessage);
    });
    this.state.set({ guests: this.guests.map((g) => g.name) });
  }

  startGame(botCount: number, botLevel: BotLevel): HostSession {
    const seats: HostSeat[] = [
      { name: this.hostName, kind: 'local' },
      ...this.guests.map(
        (g): HostSeat => ({
          name: g.name,
          kind: 'remote',
          send: (view) => g.conn.send({ t: 'view', view } satisfies HostMessage),
        }),
      ),
      ...Array.from({ length: botCount }, (_, i): HostSeat => ({ name: botSeatName(i + 1), kind: 'bot' })),
    ];
    this.session = new HostSession(seats, { botLevel });
    this.session.start();
    return this.session;
  }

  close(): void {
    this.session?.leave();
    this.session = null;
    this.peer?.destroy();
    this.peer = null;
  }
}

export interface GuestState {
  status: 'connecting' | 'lobby' | 'game' | 'error' | 'closed';
  names: string[];
  you: number;
  error?: NetError;
}

export class GuestClient implements Session {
  readonly state = new Store<GuestState>({ status: 'connecting', names: [], you: -1 });
  private peer: Peer;
  private conn: DataConnection | null = null;
  private view: PlayerView | null = null;
  private listeners = new Set<(view: PlayerView) => void>();
  private timeout: ReturnType<typeof setTimeout>;

  constructor(code: string, name: string) {
    this.peer = new Peer();
    this.timeout = setTimeout(() => {
      if (this.state.get().status === 'connecting') this.fail('cant-connect');
    }, CONNECT_TIMEOUT_MS);

    this.peer.on('open', () => {
      const conn = this.peer.connect(ROOM_PREFIX + code, { reliable: true });
      this.conn = conn;
      conn.on('open', () => conn.send({ t: 'hello', name } satisfies GuestMessage));
      conn.on('data', (data) => this.onMessage(data as HostMessage));
      conn.on('close', () => {
        if (this.state.get().status !== 'error') this.state.set({ status: 'closed' });
      });
    });
    this.peer.on('error', (err) => {
      this.fail(err.type === 'peer-unavailable' ? 'room-not-found' : 'connection-error');
    });
  }

  private fail(error: NetError): void {
    const { status } = this.state.get();
    if (status === 'error' || status === 'closed') return;
    // во время партии показываем обрыв связи, а не экран ошибки входа
    this.state.set(status === 'game' ? { status: 'closed' } : { status: 'error', error });
  }

  private onMessage(message: HostMessage): void {
    if (message.t === 'lobby') {
      this.state.set({ status: 'lobby', names: message.names, you: message.you });
    } else if (message.t === 'view') {
      this.view = message.view;
      if (this.state.get().status !== 'game') this.state.set({ status: 'game' });
      this.listeners.forEach((listener) => listener(message.view));
    } else if (message.t === 'reject') {
      this.fail(message.reason);
    }
  }

  subscribe(listener: (view: PlayerView) => void): () => void {
    this.listeners.add(listener);
    if (this.view) listener(this.view);
    return () => this.listeners.delete(listener);
  }

  move(move: Move): void {
    this.conn?.send({ t: 'move', move } satisfies GuestMessage);
  }

  newDeal(): void {
    // новую раздачу начинает хост
  }

  leave(): void {
    clearTimeout(this.timeout);
    this.listeners.clear();
    this.peer.destroy();
  }
}
