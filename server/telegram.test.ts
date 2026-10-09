import { describe, expect, it } from 'vitest';
import { verifyInitData } from './telegram';
import { signInitData } from './test-telegram';

const TOKEN = '123456:test-token-for-signatures';

const now = Date.now();
const fields = {
  user: JSON.stringify({ id: 42, first_name: 'Аня', language_code: 'ru' }),
  auth_date: String(Math.floor(now / 1000) - 60),
  start_param: 'ABCDE',
};

describe('подпись игрока Telegram', () => {
  it('принимает подписанные данные и достаёт игрока', () => {
    expect(verifyInitData(signInitData(fields), TOKEN, now)).toEqual({ id: 42, firstName: 'Аня', lang: 'ru' });
  });

  it('не принимает подделку, чужой токен и устаревшие данные', () => {
    const forged = signInitData(fields).replace('%2242%22', '%2243%22').replace('42', '43');
    expect(verifyInitData(forged, TOKEN, now)).toBeNull();
    expect(verifyInitData(signInitData(fields, '999:other'), TOKEN, now)).toBeNull();
    const old = { ...fields, auth_date: String(Math.floor(now / 1000) - 3 * 24 * 3600) };
    expect(verifyInitData(signInitData(old), TOKEN, now)).toBeNull();
    expect(verifyInitData('user=x&hash=zz', TOKEN, now)).toBeNull();
    expect(verifyInitData(signInitData(fields), '', now)).toBeNull();
  });
});
