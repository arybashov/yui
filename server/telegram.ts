import { createHmac, timingSafeEqual } from 'node:crypto';

// Telegram для игрового сервера: проверка подписи игрока (initData) и связь с ботом.
// Сам Telegram API с этого сервера недоступен (российский дата-центр), поэтому счета
// и оплату ведёт бот на Cloudflare (папка bot/), а сервер спрашивает его по HTTPS.

export interface TelegramUser {
  id: number;
  firstName: string;
  /** язык Telegram игрока: ru — счёт по-русски, остальные — по-английски */
  lang: string;
}

/** initData живёт, пока открыта игра; старше суток не принимаем. */
const MAX_AGE_S = 24 * 3600;

/**
 * Проверить initData, которую Telegram передал игре, и достать из неё игрока.
 * Подпись — HMAC-SHA256 от отсортированных полей ключом HMAC("WebAppData", токен бота).
 * Поле signature (Bot API 8.0) в одних версиях входит в подписанную строку, в других нет — пробуем оба.
 */
export function verifyInitData(initData: unknown, botToken: string, now = Date.now()): TelegramUser | null {
  if (!botToken || typeof initData !== 'string' || !initData || initData.length > 4096) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash') ?? '';
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  const expected = Buffer.from(hash, 'hex');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const signed = (skip: string[]) =>
    [...params]
      .filter(([key]) => !skip.includes(key))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
  const valid = [['hash'], ['hash', 'signature']].some((skip) =>
    timingSafeEqual(createHmac('sha256', secret).update(signed(skip)).digest(), expected),
  );
  if (!valid) return null;
  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || now / 1000 - authDate > MAX_AGE_S) return null;
  try {
    const user = JSON.parse(params.get('user') ?? '');
    if (typeof user?.id !== 'number') return null;
    return {
      id: user.id,
      firstName: typeof user.first_name === 'string' ? user.first_name : '',
      lang: user.language_code === 'ru' ? 'ru' : 'en',
    };
  } catch {
    return null;
  }
}

/** Суммы «Поддержать» в звёздах — кнопки в игре; другие сервер не выставляет. */
export const SUPPORT_AMOUNTS = [50, 150, 500];

const RELAY_TIMEOUT_MS = 6000;
/** «не поддерживал» перепроверяем не чаще раза в 10 минут, «поддерживал» — навсегда */
const NEGATIVE_TTL_MS = 10 * 60 * 1000;

interface StarsCount {
  stars: number;
  payments: number;
  supporters: number;
}
export interface StarsSummary {
  period: StarsCount;
  total: StarsCount;
}

/** Бот на Cloudflare: кто поддержал игру и счёт на оплату. Без адреса — всё «нет». */
export function createBotRelay(url: string, secret: string) {
  const known = new Map<number, { supporter: boolean; at: number }>();
  const call = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${url}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`bot relay ${path}: ${response.status}`);
    return response.json();
  };

  return {
    enabled: Boolean(url && secret),

    /** Поддержал ли игрок игру; fresh — не верить кэшу (сразу после оплаты). */
    async isSupporter(userId: number, fresh = false): Promise<boolean> {
      if (!url || !secret) return false;
      const cached = known.get(userId);
      if (cached && !fresh && (cached.supporter || Date.now() - cached.at < NEGATIVE_TTL_MS)) return cached.supporter;
      try {
        const data = await call(`/supporter?id=${userId}`);
        const supporter = Boolean(data?.supporter);
        known.set(userId, { supporter, at: Date.now() });
        return supporter;
      } catch (error) {
        console.warn((error as Error).message);
        return cached?.supporter ?? false;
      }
    },

    /** Звёзды для админки: за период с since (мс) и за всё время; null — бот недоступен или не настроен. */
    async summary(since: number): Promise<StarsSummary | null> {
      if (!url || !secret) return null;
      try {
        return (await call(`/summary?since=${since}`)) as StarsSummary;
      } catch (error) {
        console.warn((error as Error).message);
        return null;
      }
    },

    /** Ссылка на счёт «Поддержать» на amount звёзд или null, если бот недоступен. */
    async invoice(userId: number, amount: number, lang: string): Promise<string | null> {
      if (!url || !secret || !SUPPORT_AMOUNTS.includes(amount)) return null;
      try {
        const data = await call('/invoice', { method: 'POST', body: JSON.stringify({ userId, amount, lang }) });
        return typeof data?.link === 'string' ? data.link : null;
      } catch (error) {
        console.warn((error as Error).message);
        return null;
      }
    },
  };
}

export type BotRelay = ReturnType<typeof createBotRelay>;
