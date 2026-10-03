// Название игры; его же буквы получает проигравший раздачу (см. session.ts).
// При смене названия поправить и <title> в index.html.
export const GAME_TITLE = 'YUI';

/** Версия сборки, как в «Городках»: 1.0.N. Вне Vite (сервер, тесты без define) — dev. */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
