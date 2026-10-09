import { clientMeta } from './identity';
import { SERVER_URL } from './online';
import { Store } from '../store';
import { Activity, ClientMessage, ServerMessage } from './protocol';

// Присутствие для статистики: пока игра открыта, держим с сервером одно лёгкое соединение
// и сообщаем, чем занят игрок вне онлайна — меню, игра с ботами, обучение. Без него сервер
// видел только онлайн-партии. Игре оно не нужно: если связи нет, просто пробуем позже, молча.
// В Telegram по нему же сервер сообщает, поддержал ли игрок игру, и выдаёт счёт «Поддержать».

const RETRY_MIN_MS = 5000;
const RETRY_MAX_MS = 120000;

let socket: WebSocket | null = null;
let activity: Activity = 'menu';
let engaged = false;
let retries = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;

/** Поддержал ли игрок игру (Telegram). Обновляется с сервера. */
export const supporterStatus = new Store<{ supporter: boolean }>({ supporter: false });

/** Ждущие ответа запросы счёта: сервер отвечает по порядку. */
const invoiceWaiters: ((link: string | null) => void)[] = [];
const INVOICE_TIMEOUT_MS = 10000;

function onMessage(event: MessageEvent): void {
  let message: ServerMessage;
  try {
    message = JSON.parse(String(event.data)) as ServerMessage;
  } catch {
    return;
  }
  if (message.t === 'supporter') supporterStatus.set({ supporter: message.supporter });
  if (message.t === 'invoice') invoiceWaiters.shift()?.(message.link);
}

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
  invoiceWaiters.splice(0).forEach((resolve) => resolve(null));
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
  next.onmessage = onMessage;
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

/** Ссылка на счёт «Поддержать» на amount звёзд; null — сервер или бот сейчас недоступны. */
export function requestInvoice(amount: number): Promise<string | null> {
  if (socket?.readyState !== WebSocket.OPEN) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const finish = (link: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const index = invoiceWaiters.indexOf(finish);
      if (index >= 0) invoiceWaiters.splice(index, 1);
      resolve(link);
    };
    const timer = setTimeout(() => finish(null), INVOICE_TIMEOUT_MS);
    invoiceWaiters.push(finish);
    send({ t: 'invoice', amount });
  });
}

/** После оплаты: попросить сервер проверить поддержку заново (бот узнаёт об оплате чуть позже). */
export function recheckSupporter(): void {
  send({ t: 'supporterCheck' });
}
