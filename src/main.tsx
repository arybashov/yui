import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { gameReady, initPlatform, platformPause } from './platform/yandex';
import { preloadCards } from './ui/CardView';
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

async function start(): Promise<void> {
  // язык площадки нужен до первой отрисовки, иначе интерфейс мигнёт другим языком
  await initPlatform();
  watchFocus();
  blockContextMenu();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  await preloadCards();
  gameReady();
}

void start();
