import { startServer } from './server';

const port = Number(process.env.PORT) || 8787;
const host = process.env.HOST || undefined;
startServer({ port, host });
console.log(`YUI game server is listening on ${host ?? '*'}:${port}`);
