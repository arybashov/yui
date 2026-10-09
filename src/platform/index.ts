import * as telegram from './telegram';
import * as yandex from './yandex';

// Площадка, под которую собрана игра: `--mode telegram` — Telegram, иначе Яндекс
// (в обычной сборке для сайта SDK Яндекса нет, и его функции ничего не делают).
// Режим известен при сборке, поэтому код второй площадки в архив не попадает.

export const IS_TELEGRAM = telegram.IS_TELEGRAM;
export const IS_YANDEX = yandex.IS_YANDEX;
/** Кнопку «Поделиться результатом» показываем только там, где есть окно «Поделиться». */
export const CAN_SHARE_RESULT = IS_TELEGRAM;

const active = IS_TELEGRAM ? telegram : yandex;

export const platformPause = active.platformPause;
export const initPlatform = active.initPlatform;
export const gameReady = active.gameReady;
export const markGameplay = active.markGameplay;
export const showInterstitial = active.showInterstitial;
export const invitePayload = active.invitePayload;
export const inviteLink = active.inviteLink;

// Только в Telegram: окно «Поделиться», имя игрока, вибрация через клиент.
export const shareInvite: (code: string, text: string) => boolean = IS_TELEGRAM ? telegram.shareInvite : () => false;
export const shareResult: (text: string) => boolean = IS_TELEGRAM ? telegram.shareResult : () => false;
export const platformPlayerName: () => string = IS_TELEGRAM ? telegram.platformPlayerName : () => '';
export const telegramInitData: () => string = IS_TELEGRAM ? telegram.telegramInitData : () => '';
export const openInvoice: (link: string) => Promise<string> = IS_TELEGRAM ? telegram.openInvoice : async () => 'failed';
export const requestWriteAccess: () => Promise<boolean> = IS_TELEGRAM ? telegram.requestWriteAccess : async () => false;
export const platformVibrate: () => boolean = IS_TELEGRAM ? telegram.platformVibrate : () => false;
