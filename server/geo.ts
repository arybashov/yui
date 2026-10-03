import { readFileSync, statSync } from 'node:fs';
import { isIP } from 'node:net';
import { gunzipSync } from 'node:zlib';

// Определение страны по IP — порт модуля RRaM. Данные (ip2country-v4/v6.tsv.gz)
// берутся из каталога GEO_DIR; у нас это admin-assets RRaM на том же сервере.
// Нет данных — страна «ZZ» (не определена), остальная статистика работает.

export function ipNumber(value: string): { version: 4 | 6; value: bigint } | null {
  let ip = String(value).replace(/^::ffff:(?=\d+\.)/i, '');
  const version = isIP(ip);
  if (version === 4) return { version: 4, value: ip.split('.').reduce((n, v) => n * 256n + BigInt(v), 0n) };
  if (version !== 6) return null;
  ip = ip.split('%')[0];
  if (ip.includes('.')) {
    const pos = ip.lastIndexOf(':');
    const v4 = ipNumber(ip.slice(pos + 1))!.value;
    ip = ip.slice(0, pos + 1) + (v4 >> 16n).toString(16) + ':' + (v4 & 65535n).toString(16);
  }
  const halves = ip.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const parts =
    halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  return { version: 6, value: parts.reduce((n, v) => n * 65536n + BigInt('0x' + v), 0n) };
}

/** Реальный IP клиента: доверяем только заголовку от нашего же nginx (loopback). */
export function clientIp(remote: string, xRealIp: string | undefined): string {
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote);
  return local && xRealIp && isIP(xRealIp) ? xRealIp : remote;
}

interface Row {
  start: bigint;
  end: bigint;
  country: string;
}

export interface Geo {
  lookup(ip: string): string;
  available: boolean;
  updatedAt: number | null;
}

export function createGeoLookup(dir: string | undefined): Geo {
  const tables: Record<4 | 6, Row[]> = { 4: [], 6: [] };
  let updatedAt: number | null = null;
  if (dir) {
    for (const version of [4, 6] as const) {
      try {
        const path = `${dir}/ip2country-v${version}.tsv.gz`;
        tables[version] = gunzipSync(readFileSync(path))
          .toString('utf8')
          .trim()
          .split('\n')
          .map((line) => {
            const [start, end, country] = line.trim().split('\t');
            return {
              start: version === 4 ? BigInt(start) : ipNumber(start)!.value,
              end: version === 4 ? BigInt(end) : ipNumber(end)!.value,
              country,
            };
          });
        updatedAt = Math.max(updatedAt ?? 0, statSync(path).mtimeMs);
      } catch (error) {
        tables[version] = [];
        console.warn(`Geo IPv${version} unavailable: ${(error as Error).message}`);
      }
    }
  }
  function lookup(ip: string): string {
    const n = ipNumber(ip);
    if (!n) return 'ZZ';
    const rows = tables[n.version];
    let lo = 0;
    let hi = rows.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = rows[mid];
      if (n.value < r.start) hi = mid - 1;
      else if (n.value > r.end) lo = mid + 1;
      else return /^[A-Z]{2}$/.test(r.country) ? r.country : 'ZZ';
    }
    return 'ZZ';
  }
  return { lookup, updatedAt, available: Boolean(tables[4].length && tables[6].length) };
}
