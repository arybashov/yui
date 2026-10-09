import { BotLevel } from '../game/bot';
import { Move } from '../game/engine';
import { PlayerView } from '../game/session';
import { NetError } from '../i18n/types';

// Сообщения между браузером и игровым сервером (JSON поверх WebSocket).

/** Данные для аналитики, которые клиент прикладывает при входе (необязательные). */
export interface ClientMeta {
  /** анонимный идентификатор посетителя (из localStorage), не аккаунт */
  visitorId?: string;
  /** площадка: site (сайт), yandex (Яндекс Игры), telegram (Telegram), local (разработка) */
  platform?: string;
  /** версия клиента */
  version?: string;
  /** Telegram: подписанные данные игрока (initData) — сервер узнаёт по ним, кто это */
  tgInitData?: string;
}

/** Чем игрок занят вне онлайн-комнаты. */
export type Activity = 'menu' | 'ai' | 'tutorial';

export type ClientMessage =
  | ({ t: 'create'; name: string } & ClientMeta)
  | ({ t: 'join'; code: string; name: string } & ClientMeta)
  /** быстрая игра: сервер сам сводит незнакомых игроков в одну партию */
  | ({ t: 'quick'; name: string } & ClientMeta)
  /** возврат в идущую партию после обрыва связи */
  | ({ t: 'rejoin'; code: string; token: string } & ClientMeta)
  | { t: 'start'; bots: number; level: BotLevel }
  | { t: 'move'; move: Move }
  | { t: 'newDeal' }
  /** сдаться в текущей раздаче */
  | { t: 'resign' }
  /** меню спрашивает, жив ли сервер и сколько на нём людей */
  | ({ t: 'ping' } & ClientMeta)
  /** где игрок вне онлайна: в меню, играет с ботами или в обучении (для статистики);
   *  engaged — сделал ход в текущей партии */
  | ({ t: 'presence'; activity: Activity; engaged?: boolean } & ClientMeta)
  /** Telegram: счёт «Поддержать» на amount звёзд */
  | { t: 'invoice'; amount: number }
  /** Telegram: проверить ещё раз, поддержал ли игрок (сразу после оплаты) */
  | { t: 'supporterCheck' }
  /** вкладка видима/скрыта — для учёта времени в игре */
  | { t: 'visible'; visible: boolean };

export type ServerMessage =
  /** игрок принят в комнату; token нужен для возврата после обрыва */
  | { t: 'joined'; code: string; token: string }
  | {
      t: 'lobby';
      names: string[];
      you: number;
      owner: number;
      /** комната быстрой игры: стартует сама, без кода и без ботов */
      quick?: boolean;
      /** через сколько мс партия начнётся сама (быстрая игра, когда собралось двое) */
      startsIn?: number | null;
      /** сколько людей сейчас на сервере */
      online?: number;
    }
  | { t: 'view'; view: PlayerView }
  /** ответ на ping: людей на сервере (кроме спросившего) и сколько из них ищут соперника */
  | { t: 'status'; online: number; searching: number }
  /** Telegram: поддержал ли игру этот игрок */
  | { t: 'supporter'; supporter: boolean }
  /** Telegram: ссылка на счёт или null, если выставить не удалось */
  | { t: 'invoice'; link: string | null }
  | { t: 'error'; code: NetError };

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
