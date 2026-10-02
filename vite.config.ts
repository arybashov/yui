import react from '@vitejs/plugin-react';
import { Plugin, defineConfig } from 'vite';

/** Сборка для Яндекс Игр (`--mode yandex`): площадка требует подключать её SDK тегом в <head>. */
const yandexSdk = (mode: string): Plugin => ({
  name: 'yandex-games-sdk',
  transformIndexHtml: () =>
    mode === 'yandex' ? [{ tag: 'script', attrs: { src: '/sdk.js' }, injectTo: 'head' }] : [],
});

export default defineConfig(({ mode }) => ({
  // относительные пути, чтобы сборку можно было положить на любой статический хостинг
  base: './',
  plugins: [react(), yandexSdk(mode)],
  // без явного адреса Vite на Windows слушает только IPv6, и http://127.0.0.1 не открывается
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
}));
