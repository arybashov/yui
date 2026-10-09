import { clientMeta } from './identity';
import { SERVER_URL } from './online';
import { Activity, ClientMessage } from './protocol';

// Присутствие для статистики: пока игра открыта, держим с сервером одно лёгкое соединение
// и сообщаем, чем занят игрок вне онлайна — меню, игра с ботами, обучение. Без него сервер
// видел только онлайн-партии. Игре оно не нужно: если связи нет, просто пробуем позже, молча.

const RETRY_MIN_MS = 5000;
const RETRY_MAX_MS = 120000;

let socket: WebSocket | null = null;
let activity: Activity = 'menu';
let engaged = false;
let retries = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;

function send(message: ClientMessage): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function sendState(): void {
  send({ t: 'presence', activity, engaged, ...clientMeta() });
}

function sendVisible(): void {
  send({ t: 'visible', visible: document.visibilityState === 'visible' });
}

/** Соединение оборвалось или не открылось. Заблокированный адрес присылает только error, без close. */
function lost(dead: WebSocket): void {
  if (socket !== dead) return;
  socket = null;
  if (retryTimer) return;
  const delay = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** retries++);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connect();
  }, delay);
}

function connect(): void {
  let next: WebSocket;
  try {
    next = new WebSocket(SERVER_URL);
  } catch {
    return;
  }
  socket = next;
  next.onopen = () => {
    retries = 0;
    sendState();
    sendVisible();
  };
  next.onclose = () => lost(next);
  next.onerror = () => lost(next);
}

/** Начать сообщать о присутствии. В сборке без игрового сервера ничего не делает. */
export function startPresence(): void {
  if (started || !SERVER_URL) return;
  started = true;
  connect();
  document.addEventListener('visibilitychange', sendVisible);
}

/** Игрок перешёл в меню, к ботам или в обучение; engaged — уже сделал ход в этой партии. */
export function setActivity(next: Activity, nextEngaged = false): void {
  if (next === activity && nextEngaged === engaged) return;
  activity = next;
  engaged = nextEngaged;
  sendState();
}
