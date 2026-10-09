import { createHmac } from 'node:crypto';

/** Для тестов: initData, подписанная так же, как её подписывает Telegram. */
export function signInitData(fields: Record<string, string>, token = '123456:test-token-for-signatures'): string {
  const check = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}
