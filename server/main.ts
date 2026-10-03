import { startServer } from './server';

const port = Number(process.env.PORT) || 8787;
const host = process.env.HOST || undefined;
// STATS_FILE и GEO_DIR сервер читает из окружения сам; PULSE_MS — для отладки
const pulseMs = Number(process.env.PULSE_MS) || undefined;
startServer({ port, host, pulseMs });
console.log(`YUI game server is listening on ${host ?? '*'}:${port}`);
