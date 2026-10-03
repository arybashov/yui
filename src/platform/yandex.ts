import { setPlatformLang } from '../i18n';
import { Store } from '../store';

// Связь с площадкой Яндекс Игр. Сборка для Яндекса делается командой
// `npm run build:yandex`: в ней в index.html добавлен <script src="/sdk.js">.
// В остальных сборках SDK нет, и все функции этого модуля ничего не делают.

interface AdCallbacks {
  onOpen?: () => void;
  onClose?: (wasShown: boolean) => void;
  onError?: (error: unknown) => void;
}

interface YandexSdk {
  environment: { app: { id: string }; i18n: { lang: string }; payload?: string };
  features: {
    LoadingAPI?: { ready(): void };
    GameplayAPI?: { start(): void; stop(): void };
  };
  adv: { showFullscreenAdv(options: { callbacks: AdCallbacks }): void };
  on(event: 'game_api_pause' | 'game_api_resume', listener: () => void): void;
}

declare global {
  interface Window {
    YaGames?: { init(): Promise<YandexSdk> };
  }
}

export const IS_YANDEX = import.meta.env.MODE === 'yandex';

const INIT_TIMEOUT_MS = 5000;
const AD_TIMEOUT_MS = 60000;

let sdk: YandexSdk | null = null;
let gameplayActive = false;

/** Площадка просит поставить игру на паузу: реклама, другая вкладка, свёрнутое окно. */
export const platformPause = new Store<{ paused: boolean }>({ paused: false });

// Две независимые причины — сигнал SDK и показ нашей рекламы: конец одной не снимает другую.
let sdkPaused = false;
let adShowing = false;
const updatePause = () => {
  const paused = sdkPaused || adShowing;
  if (platformPause.get().paused !== paused) platformPause.set({ paused });
};

export async function initPlatform(): Promise<void> {
  if (!IS_YANDEX || !window.YaGames) return;
  try {
    // если SDK не ответил вовремя, игра всё равно должна запуститься
    sdk = await Promise.race([
      window.YaGames.init(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), INIT_TIMEOUT_MS)),
    ]);
  } catch {
    sdk = null;
  }
  if (!sdk) return;
  setPlatformLang(sdk.environment.i18n.lang);
  sdk.on('game_api_pause', () => {
    sdkPaused = true;
    updatePause();
  });
  sdk.on('game_api_resume', () => {
    sdkPaused = false;
    updatePause();
  });
}

/** Игра загрузилась и готова к действиям игрока. */
export function gameReady(): void {
  sdk?.features.LoadingAPI?.ready();
}

/** Разметка геймплея: идёт ли сейчас раздача. Повторные вызовы с тем же значением игнорируются. */
export function markGameplay(active: boolean): void {
  if (active === gameplayActive) return;
  gameplayActive = active;
  if (active) sdk?.features.GameplayAPI?.start();
  else sdk?.features.GameplayAPI?.stop();
}

/** Полноэкранная реклама в логической паузе. Завершается, когда рекламу закрыли или она не показалась. */
export function showInterstitial(): Promise<void> {
  if (!sdk) return Promise.resolve();
  const adv = sdk.adv;
  return new Promise((resolve) => {
    // Как в «Городках»: на время рекламы звук и боты стоят, даже если SDK не прислал паузу.
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      adShowing = false;
      updatePause();
      resolve();
    };
    const timer = setTimeout(done, AD_TIMEOUT_MS);
    const opened = () => {
      adShowing = true;
      updatePause();
    };
    try {
      adv.showFullscreenAdv({ callbacks: { onOpen: opened, onClose: done, onError: done } });
    } catch {
      done();
    }
  });
}

/** Код комнаты, с которым игру открыли по ссылке-приглашению. */
export function invitePayload(): string {
  return sdk?.environment.payload ?? '';
}

/** Ссылка-приглашение в комнату: на площадке — страница игры в каталоге, вне её — адрес сайта. */
export function inviteLink(code: string): string {
  if (sdk) return `https://yandex.ru/games/app/${sdk.environment.app.id}?payload=${code}`;
  return `${location.origin}${location.pathname}?room=${code}`;
}
