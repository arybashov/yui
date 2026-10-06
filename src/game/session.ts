import { GAME_TITLE } from '../config';
import { BotLevel, chooseMove } from './bot';
import { Card, GameState, LogEntry, Move, applyMove, deal } from './engine';

export interface PlayerInfo {
  /** у ботов — служебное имя вида «Bot 1», на экране его переводит botName() */
  name: string;
  isBot: boolean;
  /** место человека, за которого временно играет бот: нет связи */
  away: boolean;
  count: number;
  /** место, на котором игрок вышел из раздачи (1 — первый), иначе null */
  place: number | null;
  /** проигранные раздачи в текущем матче: за каждую игрок получает букву названия */
  losses: number;
}

/** То, что видит один игрок: чужие руки — только количеством карт. */
export interface PlayerView {
  seat: number;
  players: PlayerInfo[];
  hand: Card[];
  pile: Card[];
  turn: number;
  phase: 'playing' | 'over';
  loser: number | null;
  log: LogEntry[];
  /** сколько ходов сделано в раздаче; log хранит только последние */
  moveNo: number;
  dealNo: number;
  /** кто собрал все буквы и проиграл матч; следующая раздача начнёт новый матч */
  matchLoser: number | null;
  canRestart: boolean;
}

export interface Session {
  subscribe(listener: (view: PlayerView) => void): () => void;
  move(move: Move): void;
  newDeal(): void;
  leave(): void;
  /** Остановить или продолжить ботов. Есть только там, где партию ведёт этот браузер. */
  pauseFor?(reason: PauseReason, on: boolean): void;
}

/** Почему партия на паузе: игрок открыл меню или площадка попросила (реклама, свёрнутое окно). */
/** пауза: меню, площадка (реклама, свёрнуто), телефон повёрнут горизонтально */
export type PauseReason = 'menu' | 'platform' | 'rotate';

export interface HostSeat {
  name: string;
  kind: 'local' | 'bot' | 'remote';
  /** для удалённого игрока — отправка его вида по сети */
  send?: (view: PlayerView) => void;
  /** имя игрока, за которого временно играет бот, пока нет связи */
  human?: string;
}

export interface HostOptions {
  botLevel: BotLevel;
  botDelayMs?: number;
  onLeave?: () => void;
  /** кто может начинать новую раздачу; по умолчанию — локальный игрок */
  ownerSeat?: number;
}

const LOG_TAIL = 6;
export const LOSSES_TO_LOSE_MATCH = GAME_TITLE.length;

/** Ведёт партию: локальную с ботами, сетевую на стороне хоста и на игровом сервере
 *  (там локального игрока нет, все места — удалённые или боты). */
export class HostSession implements Session {
  private state: GameState;
  private losses: number[];
  private dealNo = 1;
  private listeners = new Set<(view: PlayerView) => void>();
  private botTimer: ReturnType<typeof setTimeout> | null = null;
  private pauses = new Set<PauseReason>();
  private readonly localSeat: number;
  private ownerSeat: number;
  // для аналитики: когда началась текущая раздача и сколько ходов сделал каждый игрок
  private dealStartedAt = Date.now();
  private actions: number[];

  constructor(
    private seats: HostSeat[],
    private options: HostOptions,
  ) {
    this.localSeat = seats.findIndex((s) => s.kind === 'local');
    this.ownerSeat = options.ownerSeat ?? this.localSeat;
    this.losses = seats.map(() => 0);
    this.actions = seats.map(() => 0);
    this.state = deal(seats.length);
  }

  start(): void {
    this.broadcast();
  }

  subscribe(listener: (view: PlayerView) => void): () => void {
    this.listeners.add(listener);
    if (this.localSeat >= 0) listener(this.viewFor(this.localSeat));
    return () => this.listeners.delete(listener);
  }

  move(move: Move): void {
    this.handleMove(this.localSeat, move);
  }

  handleMove(seat: number, move: Move): void {
    if (this.state.phase !== 'playing' || this.state.turn !== seat) return;
    try {
      this.state = applyMove(this.state, move);
    } catch {
      return;
    }
    this.actions[seat]++;
    if (this.state.phase === 'over' && this.state.loser !== null) {
      this.losses[this.state.loser]++;
    }
    this.broadcast();
  }

  newDeal(): void {
    if (this.state.phase !== 'over') return;
    if (this.matchLoser() !== null) {
      this.losses = this.seats.map(() => 0);
      this.dealNo = 0;
    }
    this.state = deal(this.seats.length);
    this.dealNo++;
    this.actions = this.seats.map(() => 0);
    this.dealStartedAt = Date.now();
    this.broadcast();
  }

  /** Игрок отключился — за него доигрывает бот. */
  detach(seat: number): void {
    const current = this.seats[seat];
    if (!current || current.kind !== 'remote') return;
    this.seats[seat] = { name: current.name, kind: 'bot', human: current.name };
    this.broadcast();
  }

  /** Боты стоят, пока есть хоть одна причина паузы: закрытие меню не снимает паузу площадки. */
  pauseFor(reason: PauseReason, on: boolean): void {
    if (on) this.pauses.add(reason);
    else this.pauses.delete(reason);
    this.scheduleBot();
  }

  /** Отключившийся игрок вернулся и снова играет сам. */
  attach(seat: number, send: (view: PlayerView) => void): void {
    const current = this.seats[seat];
    if (!current || current.kind === 'local') return;
    // настоящего бота игроком не подменяем
    if (current.kind === 'bot' && current.human === undefined) return;
    this.seats[seat] = { name: current.human ?? current.name, kind: 'remote', send };
    this.broadcast();
  }

  setOwner(seat: number): void {
    if (seat === this.ownerSeat) return;
    this.ownerSeat = seat;
    this.broadcast();
  }

  /** Сводка партии для админки: без карт на руках, только состояние, игроки и аналитика. */
  snapshot(): {
    phase: GameState['phase'];
    dealNo: number;
    startedAt: number;
    players: {
      name: string;
      isBot: boolean;
      away: boolean;
      count: number;
      place: number | null;
      actions: number;
    }[];
  } {
    const { state } = this;
    return {
      phase: state.phase,
      dealNo: this.dealNo,
      startedAt: this.dealStartedAt,
      players: this.seats.map((seat, i) => ({
        name: seat.human ?? seat.name,
        isBot: seat.kind === 'bot',
        away: seat.human !== undefined,
        count: state.hands[i].length,
        place: state.finished.includes(i) ? state.finished.indexOf(i) + 1 : null,
        actions: this.actions[i],
      })),
    };
  }

  /** Новая раздача по просьбе удалённого игрока — только если он владелец комнаты. */
  requestNewDeal(seat: number): void {
    if (seat === this.ownerSeat) this.newDeal();
  }

  leave(): void {
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
    this.listeners.clear();
    this.options.onLeave?.();
  }

  private matchLoser(): number | null {
    const seat = this.losses.findIndex((n) => n >= LOSSES_TO_LOSE_MATCH);
    return seat >= 0 ? seat : null;
  }

  private viewFor(seat: number): PlayerView {
    const { state } = this;
    return {
      seat,
      players: this.seats.map((s, i) => ({
        name: s.name,
        isBot: s.kind === 'bot',
        away: s.human !== undefined,
        count: state.hands[i].length,
        place: state.finished.includes(i) ? state.finished.indexOf(i) + 1 : null,
        losses: this.losses[i],
      })),
      hand: state.hands[seat],
      pile: state.pile,
      turn: state.turn,
      phase: state.phase,
      loser: state.loser,
      log: state.log.slice(-LOG_TAIL),
      moveNo: state.log.length,
      dealNo: this.dealNo,
      matchLoser: this.state.phase === 'over' ? this.matchLoser() : null,
      canRestart: seat === this.ownerSeat,
    };
  }

  private broadcast(): void {
    this.seats.forEach((seat, i) => {
      if (seat.kind === 'remote') seat.send?.(this.viewFor(i));
    });
    if (this.localSeat >= 0) {
      const local = this.viewFor(this.localSeat);
      this.listeners.forEach((listener) => listener(local));
    }
    this.scheduleBot();
  }

  private scheduleBot(): void {
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
    const { state } = this;
    if (this.pauses.size > 0 || state.phase !== 'playing' || this.seats[state.turn].kind !== 'bot') return;
    const seat = state.turn;
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      const move = chooseMove(state.hands[seat], state.pile, this.options.botLevel);
      this.handleMove(seat, move);
    }, this.options.botDelayMs ?? 1000);
  }
}

/** Служебное имя бота: не зависит от языка, чтобы партию могли вести и сервер, и чужой браузер. */
export const botSeatName = (n: number): string => `Bot ${n}`;

/** Номер бота по служебному имени или null, если это имя игрока. */
export function botNumber(player: PlayerInfo): number | null {
  const match = player.isBot && !player.away ? /^Bot (\d+)$/.exec(player.name) : null;
  return match ? Number(match[1]) : null;
}
