import { useCallback, useEffect, useState } from 'react';
import { clientMeta } from './identity';
import { ServerMessage } from './protocol';

// Индикатор в меню: доступен ли игровой сервер прямо сейчас. Проверяется тем же
// путём, что и игра (WebSocket), — значит, ловит и закрытый площадкой адрес.

export type ServerStatus =
  | { kind: 'checking' }
  | { kind: 'online'; online: number; searching: number }
  | { kind: 'offline' };

const CHECK_TIMEOUT_MS = 6000;
/** пока меню открыто, сервер перепроверяется сам */
const RECHECK_MS = 30000;

function probe(url: string): Promise<ServerStatus> {
  return new Promise((resolve) => {
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      resolve({ kind: 'offline' });
      return;
    }
    let done = false;
    const finish = (status: ServerStatus) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
      resolve(status);
    };
    const timer = setTimeout(() => finish({ kind: 'offline' }), CHECK_TIMEOUT_MS);
    socket.onopen = () => socket.send(JSON.stringify({ t: 'ping', ...clientMeta() }));
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        if (message.t === 'status') {
          finish({ kind: 'online', online: message.online, searching: message.searching });
        }
      } catch {
        finish({ kind: 'offline' });
      }
    };
    // заблокированное соединение присылает только error, без close
    socket.onerror = () => finish({ kind: 'offline' });
    socket.onclose = () => finish({ kind: 'offline' });
  });
}

/** Состояние сервера для меню; recheck — проверить сейчас (кнопка). Без адреса — null. */
export function useServerStatus(url: string): { status: ServerStatus | null; recheck: () => void } {
  const [status, setStatus] = useState<ServerStatus | null>(url ? { kind: 'checking' } : null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!url) return;
    let alive = true;
    const run = () =>
      probe(url).then((next) => {
        if (alive) setStatus(next);
      });
    void run();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void run();
    }, RECHECK_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [url, round]);

  const recheck = useCallback(() => {
    setStatus({ kind: 'checking' });
    setRound((n) => n + 1);
  }, []);

  return { status, recheck };
}
