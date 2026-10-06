import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { chooseLang } from './i18n';
import { gameReady, initPlatform, platformPause } from './platform/yandex';
import { preloadCards } from './ui/CardView';
import { startAutoFit } from './ui/fit';
import { setSoundSilenced } from './ui/sound';
import '@fontsource/balsamiq-sans/cyrillic-400.css';
import '@fontsource/balsamiq-sans/cyrillic-700.css';
import '@fontsource/balsamiq-sans/latin-400.css';
import '@fontsource/balsamiq-sans/latin-700.css';
import './styles.css';

/** Звук молчит, пока игра не на виду: другая вкладка, свёрнутое окно, реклама площадки. */
function watchFocus(): void {
  let blurred = false;
  const update = () => setSoundSilenced(document.hidden || blurred || platformPause.get().paused);
  const setBlurred = (value: boolean) => () => {
    blurred = value;
    update();
  };
  document.addEventListener('visibilitychange', update);
  window.addEventListener('blur', setBlurred(true));
  window.addEventListener('focus', setBlurred(false));
  // нажатие внутри игры означает, что она снова в фокусе, даже если событие focus не пришло
  window.addEventListener('pointerdown', setBlurred(false), true);
  platformPause.subscribe(update);
}

/** Долгое нажатие и правая кнопка не должны открывать меню браузера поверх игры. */
function blockContextMenu(): void {
  document.addEventListener('contextmenu', (event) => {
    if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
  });
}

/** Сколько сплэш студии держится на экране после загрузки игры. */
const SPLASH_MIN_MS = 1500;

/**
 * Показать сплэш студии и убрать его (он в index.html и виден с первой секунды загрузки).
 * Время считается от готовности игры, а не от начала загрузки: на Яндекс Играх
 * до LoadingAPI.ready() поверх игры стоит загрузочный экран площадки, и сплэш,
 * отсчитанный от начала загрузки, успевал пропасть под ним. Нажатие пропускает сплэш.
 */
function hideSplash(): Promise<void> {
  const splash = document.getElementById('splash');
  if (!splash) return Promise.resolve();
  return new Promise((resolve) => {
    const hide = () => {
      clearTimeout(timer);
      splash.removeEventListener('pointerdown', hide);
      splash.classList.add('gone');
      setTimeout(() => splash.remove(), 450);
      resolve();
    };
    const timer = setTimeout(hide, SPLASH_MIN_MS);
    splash.addEventListener('pointerdown', hide);
  });
}

async function start(): Promise<void> {
  // язык площадки нужен до первой отрисовки, иначе интерфейс мигнёт другим языком
  await initPlatform();
  watchFocus();
  blockContextMenu();

  // Только на dev-сервере: постановочные кадры для скриншотов каталога (scripts/store-shots.mjs).
  // В продакшен-сборке import.meta.env.DEV = false, и этот код вместе с модулем вырезается.
  if (import.meta.env.DEV) {
    const params = new URLSearchParams(location.search);
    const lang = params.get('lang');
    if (lang === 'ru' || lang === 'en') chooseLang(lang);
    const shot = params.get('shot');
    if (shot) {
      const { ShotScene } = await import('./dev/shots');
      document.getElementById('splash')?.remove();
      createRoot(document.getElementById('root')!).render(<ShotScene name={shot} />);
      await preloadCards();
      return;
    }
  }

  startAutoFit(document.getElementById('root')!);
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  await preloadCards();
  // сначала площадке — «загрузились» (она снимает свой экран загрузки), потом сплэш на виду
  gameReady();
  await hideSplash();
}

void start();
