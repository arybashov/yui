import { APP_VERSION } from '../config';
import { IS_YANDEX } from '../platform/yandex';
import { ClientMeta } from './protocol';

// Анонимный идентификатор посетителя для статистики (не аккаунт). Хранится в
// браузере; если localStorage недоступен — разовый на сессию.

const KEY = 'yui.visitor';

function uuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

let cached: string | null = null;

function visitorId(): string {
  if (cached) return cached;
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = uuid();
      localStorage.setItem(KEY, id);
    }
    cached = id;
  } catch {
    cached = uuid();
  }
  return cached;
}

function platform(): string {
  if (IS_YANDEX) return 'yandex';
  const host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local') || host.endsWith('.test')) {
    return 'local';
  }
  return 'site';
}

/** Мета для сообщений входа: кто посетитель, с какой площадки, какая версия. */
export function clientMeta(): ClientMeta {
  return { visitorId: visitorId(), platform: platform(), version: APP_VERSION };
}
