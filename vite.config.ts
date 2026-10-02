import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // относительные пути, чтобы сборку можно было положить на любой статический хостинг
  base: './',
  plugins: [react()],
  // без явного адреса Vite на Windows слушает только IPv6, и http://127.0.0.1 не открывается
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
