import { setPlatformLang } from '../i18n';
import { Store } from '../store';

// Связь с Telegram (Mini App бота @yui_cards_bot). Сборка для Telegram делается командой
// `npm run build:telegram`: в ней в index.html добавлен telegram-web-app.js.
// Набор функций тот же, что у Яндекса (yandex.ts), выбор — в platform/index.ts.

interface TelegramUser {
  first_name?: string;
  language_code?: string;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { user?: TelegramUser; start_param?: string };
  version: string;
  isVersionAtLeast(version: string): boolean;
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
  enableClosingConfirmation(): void;
  disableClosingConfirmation(): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  openTelegramLink(url: string): void;
  requestWriteAccess(callback: (granted: boolean) => void): void;
  openInvoice(url: string, callback: (status: 'paid' | 'cancelled' | 'failed' | 'pending') => void): void;
  onEvent(event: 'activated' | 'deactivated', listener: () => void): void;
  HapticFeedback?: { impactOccurred(style: 'light' | 'medium' | 'heavy'): void };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export const IS_TELEGRAM = import.meta.env.MODE === 'telegram';

/** Бот, у которого игра — главное приложение: по ссылке t.me/<бот>?startapp=КОД она открывается сразу в комнате. */
const BOT = import.meta.env.VITE_TELEGRAM_BOT || 'yui_cards_bot';
/** Цвет стола (theme-color в index.html): шапка Telegram сливается с игрой. */
const TABLE_COLOR = '#24150c';

// Без initData страница открыта не из Telegram (например, адрес набран в браузере):
// тогда, как и без SDK Яндекса, функции ничего не делают.
let app: TelegramWebApp | null = null;
let gameplayActive = false;

/** Площадка просит поставить игру на паузу: Telegram свёрнут или поверх открыт другой экран. */
export const platformPause = new Store<{ paused: boolean }>({ paused: false });

export async function initPlatform(): Promise<void> {
  const webApp = window.Telegram?.WebApp;
  if (!IS_TELEGRAM || !webApp?.initData) return;
  app = webApp;
  const lang = app.initDataUnsafe.user?.language_code;
  if (lang) setPlatformLang(lang);
  try {
    app.expand();
    // свайп вниз по столу иначе сворачивает игру посреди раздачи
    if (app.isVersionAtLeast('7.7')) app.disableVerticalSwipes?.();
    if (app.isVersionAtLeast('6.1')) {
      app.setHeaderColor(TABLE_COLOR);
      app.setBackgroundColor(TABLE_COLOR);
    }
    if (app.isVersionAtLeast('8.0')) {
      app.onEvent('deactivated', () => platformPause.set({ paused: true }));
      app.onEvent('activated', () => platformPause.set({ paused: false }));
    }
  } catch {
    // старый клиент Telegram без этих методов — играть всё равно можно
  }
}

/** Игра загрузилась: Telegram убирает свой экран загрузки. */
export function gameReady(): void {
  app?.ready();
}

/** Пока идёт раздача, закрытие игры просит подтверждения. */
export function markGameplay(active: boolean): void {
  if (active === gameplayActive) return;
  gameplayActive = active;
  try {
    if (active) app?.enableClosingConfirmation();
    else app?.disableClosingConfirmation();
  } catch {
    // подтверждение закрытия — не обязательное
  }
}

/** Рекламы в Telegram пока нет. */
export function showInterstitial(): Promise<void> {
  return Promise.resolve();
}

/** Код комнаты, с которым игру открыли по ссылке-приглашению (?startapp=КОД). */
export function invitePayload(): string {
  return app?.initDataUnsafe.start_param ?? '';
}

/** Ссылка-приглашение в комнату: открывает игру в Telegram сразу в этой комнате. */
export function inviteLink(code: string): string {
  if (app) return `https://t.me/${BOT}?startapp=${code}`;
  return `${location.origin}${location.pathname}?room=${code}`;
}

/** Отправить приглашение через окно «Поделиться» Telegram. false — не в Telegram, пусть копируется ссылка. */
export function shareInvite(code: string, text: string): boolean {
  if (!app) return false;
  const url = encodeURIComponent(inviteLink(code));
  app.openTelegramLink(`https://t.me/share/url?url=${url}&text=${encodeURIComponent(text)}`);
  return true;
}

/** Поделиться итогом матча: окно «Поделиться» со ссылкой, которая открывает игру. false — не в Telegram. */
export function shareResult(text: string): boolean {
  if (!app) return false;
  const url = encodeURIComponent(`https://t.me/${BOT}?startapp`);
  app.openTelegramLink(`https://t.me/share/url?url=${url}&text=${encodeURIComponent(text)}`);
  return true;
}

/** Подписанные Telegram данные игрока: по ним сервер узнаёт, кто это. Вне Telegram — пусто. */
export function telegramInitData(): string {
  return app?.initData ?? '';
}

/** Спросить у игрока разрешение, чтобы бот мог ему писать (Telegram покажет своё окно). */
export function requestWriteAccess(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!app || !app.isVersionAtLeast('6.9')) return resolve(false);
    try {
      app.requestWriteAccess(resolve);
    } catch {
      resolve(false);
    }
  });
}

/** Окно оплаты звёздами внутри Telegram; результат — как его сообщил Telegram. */
export function openInvoice(link: string): Promise<string> {
  return new Promise((resolve) => {
    if (!app || !app.isVersionAtLeast('6.1')) return resolve('failed');
    try {
      app.openInvoice(link, resolve);
    } catch {
      resolve('failed');
    }
  });
}

/** Имя игрока в Telegram — ник по умолчанию, пока игрок не ввёл свой. */
export function platformPlayerName(): string {
  return app?.initDataUnsafe.user?.first_name?.trim().slice(0, 16) ?? '';
}

/** Вибрация через Telegram (на iPhone navigator.vibrate нет). false — пусть вибрирует браузер. */
export function platformVibrate(): boolean {
  if (!app?.HapticFeedback || !app.isVersionAtLeast('6.1')) return false;
  try {
    app.HapticFeedback.impactOccurred('medium');
    return true;
  } catch {
    return false;
  }
}
