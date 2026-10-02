import { BotLevel } from '../game/bot';
import { Move } from '../game/engine';
import { PlayerView } from '../game/session';

// Сообщения между браузером и игровым сервером (JSON поверх WebSocket).

export type ClientMessage =
  | { t: 'create'; name: string }
  | { t: 'join'; code: string; name: string }
  /** возврат в идущую партию после обрыва связи */
  | { t: 'rejoin'; code: string; token: string }
  | { t: 'start'; bots: number; level: BotLevel }
  | { t: 'move'; move: Move }
  | { t: 'newDeal' };

export type ServerMessage =
  /** игрок принят в комнату; token нужен для возврата после обрыва */
  | { t: 'joined'; code: string; token: string }
  | { t: 'lobby'; names: string[]; you: number; owner: number }
  | { t: 'view'; view: PlayerView }
  | { t: 'error'; text: string };

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;
export const NAME_LENGTH = 16;

export function makeRoomCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return code;
}

export function normalizeRoomCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}
