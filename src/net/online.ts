import { BotLevel } from '../game/bot';
import { Move } from '../game/engine';
import { PlayerView, Session } from '../game/session';
import { NetError } from '../i18n/types';
import { Store } from '../store';
import { clientMeta } from './identity';
import { ClientMessage, ServerMessage } from './protocol';

/** Адрес игрового сервера. Пусто — онлайн идёт напрямую между браузерами (см. room.ts). */
export const SERVER_URL: string = import.meta.env.VITE_SERVER_URL ?? '';

const RETRY_DELAY_MS = 1500;
const MAX_RETRIES = 40;

export interface OnlineState {
  status: 'connecting' | 'lobby' | 'game' | 'reconnecting' | 'error' | 'closed';
  code: string;
  names: string[];
  you: number;
  owner: number;
  error?: NetError;
}

export type RoomEntry = { create: true; name: string } | { code: string; name: string };

/** Комната на игровом сервере: партию ведёт сервер, браузер шлёт ходы и рисует стол. */
export class OnlineRoom implements Session {
  readonly state = new Store<OnlineState>({
    status: 'connecting',
    code: '',
    names: [],
    you: -1,
    owner: 0,
  });
  private socket: WebSocket | null = null;
  private token = '';
  private view: PlayerView | null = null;
  private listeners = new Set<(view: PlayerView) => void>();
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** соединение больше не восстанавливаем: игрок вышел или сервер отказал */
  private finished = false;

  constructor(
    private url: string,
    private entry: RoomEntry,
  ) {
    this.connect();
  }

  private connect(): void {
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.onopen = () => {
      const meta = clientMeta();
      if (this.token) this.send({ t: 'rejoin', code: this.state.get().code, token: this.token, ...meta });
      else if ('create' in this.entry) this.send({ t: 'create', name: this.entry.name, ...meta });
      else this.send({ t: 'join', code: this.entry.code, name: this.entry.name, ...meta });
      this.reportVisibility();
    };
    socket.onmessage = (event) => this.onMessage(JSON.parse(String(event.data)) as ServerMessage);
    socket.onclose = () => this.onClose(socket);
  }

  /** Сообщать серверу, видна ли вкладка, — для честного учёта времени в игре. */
  private visibilityHandler = () => this.reportVisibility();
  private visibilityBound = false;
  private reportVisibility(): void {
    this.send({ t: 'visible', visible: document.visibilityState === 'visible' });
    if (!this.visibilityBound) {
      document.addEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityBound = true;
    }
  }

  private send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private onMessage(message: ServerMessage): void {
    if (message.t === 'joined') {
      this.token = message.token;
      this.retries = 0;
      this.state.set({ code: message.code });
    } else if (message.t === 'lobby') {
      this.state.set({ status: 'lobby', names: message.names, you: message.you, owner: message.owner });
    } else if (message.t === 'view') {
      this.view = message.view;
      if (this.state.get().status !== 'game') this.state.set({ status: 'game' });
      this.listeners.forEach((listener) => listener(message.view));
    } else if (message.t === 'error') {
      // отказ посреди партии — это конец партии, а не ошибка входа
      const inGame = this.view !== null;
      this.finished = true;
      this.state.set({ status: inGame ? 'closed' : 'error', error: message.code });
      this.socket?.close();
    }
  }

  private onClose(socket: WebSocket): void {
    if (this.finished || socket !== this.socket) return;
    const { status } = this.state.get();
    if ((status === 'game' || status === 'reconnecting') && this.retries < MAX_RETRIES) {
      // сервер придержит место: за нас пока играет бот
      this.retries++;
      this.state.set({ status: 'reconnecting' });
      this.retryTimer = setTimeout(() => this.connect(), RETRY_DELAY_MS);
      return;
    }
    this.finished = true;
    if (status === 'connecting') {
      this.state.set({ status: 'error', error: 'cant-connect' });
    } else {
      this.state.set({ status: 'closed', error: 'lost-server' });
    }
  }

  start(bots: number, level: BotLevel): void {
    this.send({ t: 'start', bots, level });
  }

  subscribe(listener: (view: PlayerView) => void): () => void {
    this.listeners.add(listener);
    if (this.view) listener(this.view);
    return () => this.listeners.delete(listener);
  }

  move(move: Move): void {
    this.send({ t: 'move', move });
  }

  newDeal(): void {
    this.send({ t: 'newDeal' });
  }

  leave(): void {
    this.finished = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.visibilityBound) document.removeEventListener('visibilitychange', this.visibilityHandler);
    this.listeners.clear();
    this.socket?.close();
  }
}
