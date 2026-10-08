import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Аналитика сервера YUI в формате админки RRaM: посетители, партии по дням,
// площадки, режимы, время в игре, страны по IP. Хранилище — JSON-файл (без
// нативных зависимостей, чтобы серверная сборка оставалась одним .cjs).
// Порт логики RRaM (admin-stats.js) на обычные структуры данных.

const DAY = 86400000;
const dayOf = (time: number) => new Date(time + 3 * 3600000).toISOString().slice(0, 10);

/** Идентичность для аналитики — не доказательство аккаунта. У YUI только гости. */
export function analyticsIdentity(visitorId: string | undefined): string | null {
  if (!visitorId || visitorId.length < 8 || visitorId.length > 64) return null;
  return 'guest:' + createHash('sha256').update(visitorId).digest('hex');
}

export type Platform = 'site' | 'yandex' | 'telegram' | 'local' | 'unknown';
export const platformOf = (p: string | undefined): Platform =>
  p === 'site' || p === 'yandex' || p === 'telegram' || p === 'local' ? p : 'unknown';

export interface PulseClient {
  identity: string | null;
  platform: Platform;
  country: string;
  visible: boolean;
  lastSeen: number;
  playing: boolean;
  /** режим текущей партии, если играет */
  mode: 'pvp' | 'ai';
  /** сделал ли сегодня ход */
  engaged: boolean;
}

export interface DealRecord {
  id: string;
  started: number;
  finished: number | null;
  lastActivity: number;
  mode: 'pvp' | 'ai';
  participants: { player: number; person: string | null; platform: Platform; actions: number }[];
}

interface Person {
  kind: 'guest' | 'account';
  firstSeen: number;
  lastSeen: number;
}
interface Daily {
  day: string;
  person: string;
  platform: string;
  country: string;
  mode: string;
  played: number;
  seconds: number;
}
interface Match {
  id: string;
  started: number;
  finished: number | null;
  lastActivity: number;
  mode: string;
  historical: number;
  forfeit: number;
}
interface Participant {
  room: string;
  player: number;
  person: string | null;
  platform: string;
  actions: number;
  errors: number;
}

export function createStats(file: string, now: () => number = Date.now) {
  let started = now();
  const people = new Map<string, Person>();
  const daily = new Map<string, Daily>();
  const matches = new Map<string, Match>();
  const participants = new Map<string, Participant>();

  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    started = raw.started ?? started;
    for (const p of raw.people ?? []) people.set(p.id, p);
    for (const d of raw.daily ?? []) daily.set(`${d.day}|${d.person}|${d.platform}|${d.country}|${d.mode}`, d);
    for (const m of raw.matches ?? []) matches.set(m.id, m);
    for (const p of raw.participants ?? []) participants.set(`${p.room}|${p.player}`, p);
  } catch {
    // файла ещё нет или он повреждён — начинаем с чистой статистики
  }

  let dirty = false;
  const flush = () => {
    if (!dirty) return;
    dirty = false;
    const data = {
      started,
      people: [...people].map(([id, p]) => ({ id, ...p })),
      daily: [...daily.values()],
      matches: [...matches.values()],
      participants: [...participants.values()],
    };
    try {
      writeFileSync(`${file}.tmp`, JSON.stringify(data));
      renameSync(`${file}.tmp`, file);
    } catch (error) {
      console.warn(`stats save failed: ${(error as Error).message}`);
    }
  };

  const upsertPerson = (id: string, kind: Person['kind'], time: number) => {
    const existing = people.get(id);
    if (existing) existing.lastSeen = Math.max(existing.lastSeen, time);
    else people.set(id, { kind, firstSeen: time, lastSeen: time });
  };

  const addActivity = (d: Omit<Daily, 'played' | 'seconds'>, played: number, seconds: number) => {
    const key = `${d.day}|${d.person}|${d.platform}|${d.country}|${d.mode}`;
    const row = daily.get(key);
    if (row) {
      row.played = Math.max(row.played, played);
      row.seconds += seconds;
    } else {
      daily.set(key, { ...d, played, seconds });
    }
  };

  // Время засчитывается только живым видимым вкладкам в игре; разрывы и рестарты
  // не превращаются в часы. previous — предыдущий замер по каждой личности.
  let previous = new Map<string, { time: number; mode: string; day: string }>();

  const pulse = (clients: PulseClient[], time = now()) => {
    const current = new Map<string, { c: PulseClient; mode: string }>();
    for (const c of clients) {
      if (!c.identity || !c.visible || time - c.lastSeen > 75000) continue;
      const mode = c.playing ? c.mode : 'lobby';
      // несколько вкладок одной личности не умножают время и посетителей
      if (!current.has(c.identity) || c.playing) current.set(c.identity, { c, mode });
    }
    for (const [id, { c, mode }] of current) {
      const prev = previous.get(id);
      const elapsed =
        prev && prev.mode === mode && prev.day === dayOf(time)
          ? Math.max(0, Math.min(45, (time - prev.time) / 1000))
          : 0;
      upsertPerson(id, 'guest', time);
      const country = /^[A-Z]{2}$/.test(c.country) ? c.country : 'ZZ';
      addActivity(
        { day: dayOf(time), person: id, platform: c.platform, country, mode },
        c.playing && c.engaged ? 1 : 0,
        c.playing ? elapsed : 0,
      );
    }
    previous = new Map([...current].map(([id, { mode }]) => [id, { time, mode, day: dayOf(time) }]));
    dirty = true;
  };

  const recordDeal = (deal: DealRecord) => {
    const existing = matches.get(deal.id);
    matches.set(deal.id, {
      id: deal.id,
      started: deal.started,
      finished: deal.finished ?? existing?.finished ?? null,
      lastActivity: Math.max(deal.lastActivity, existing?.lastActivity ?? 0),
      mode: deal.mode,
      historical: 0,
      forfeit: 0,
    });
    for (const p of deal.participants) {
      const key = `${deal.id}|${p.player}`;
      const prev = participants.get(key);
      participants.set(key, {
        room: deal.id,
        player: p.player,
        person: p.person ?? prev?.person ?? null,
        platform: p.platform === 'unknown' ? (prev?.platform ?? 'unknown') : p.platform,
        actions: Math.max(p.actions, prev?.actions ?? 0),
        errors: 0,
      });
    }
    dirty = true;
  };

  const summary = (daysArg?: unknown, platformArg?: unknown, modeArg?: unknown) => {
    const days = [7, 30, 90].includes(Number(daysArg)) ? Number(daysArg) : 30;
    const platform = ['site', 'yandex', 'telegram', 'local'].includes(String(platformArg)) ? String(platformArg) : 'all';
    const mode = ['pvp', 'ai', 'tutorial'].includes(String(modeArg)) ? String(modeArg) : 'all';
    const time = now();
    const end = dayOf(time);
    const start = dayOf(time - (days - 1) * DAY);
    const startMs = Date.parse(start + 'T00:00:00+03:00');

    const rowsAll = [...daily.values()].filter(
      (r) =>
        r.day >= start &&
        r.day <= end &&
        (platform === 'all' || r.platform === platform) &&
        (mode === 'all' || r.mode === mode),
    );
    const dailyRows = rowsAll.map((r) => {
      const p = people.get(r.person);
      return { ...r, first_seen: p?.firstSeen ?? 0, kind: p?.kind ?? 'guest' };
    });

    const matchRows = [...matches.values()]
      .filter((m) => m.started >= startMs && m.started <= time)
      .filter((m) => mode === 'all' || m.mode === mode)
      .filter(
        (m) =>
          platform === 'all' ||
          [...participants.values()].some((p) => p.room === m.id && p.platform === platform),
      )
      .map((m) => {
        const parts = [...participants.values()].filter((p) => p.room === m.id);
        return {
          ...m,
          actions: parts.reduce((s, p) => s + p.actions, 0),
          errors: parts.reduce((s, p) => s + p.errors, 0),
        };
      })
      .sort((a, b) => b.started - a.started);

    const distinct = (rows: { person: string }[]) => new Set(rows.map((r) => r.person)).size;
    const completed = matchRows.filter((m) => m.finished != null);
    const durations = completed
      .filter((m) => !m.historical)
      .map((m) => Math.max(0, (m.finished! - m.started) / 1000))
      .sort((a, b) => a - b);
    const median = durations.length
      ? (durations[Math.floor((durations.length - 1) / 2)] + durations[Math.floor(durations.length / 2)]) / 2
      : null;

    const group = (key: 'country' | 'platform' | 'mode') =>
      [...new Set(dailyRows.map((r) => r[key]))]
        .map((value) => {
          const rows = dailyRows.filter((r) => r[key] === value);
          return {
            key: value,
            visitors: distinct(rows),
            players: distinct(rows.filter((r) => r.played)),
            seconds: rows.reduce((s, r) => s + r.seconds, 0),
          };
        })
        .sort((a, b) => b.visitors - a.visitors);

    const trend = [];
    for (let t = startMs; t <= time; t += DAY) {
      const day = dayOf(t);
      const rows = dailyRows.filter((r) => r.day === day);
      trend.push({
        day,
        visitors: distinct(rows),
        players: distinct(rows.filter((r) => r.played)),
        matches: matchRows.filter((m) => dayOf(m.started) === day).length,
      });
    }

    return {
      since: started,
      now: time,
      days,
      start,
      end,
      platform,
      mode,
      totals: {
        visitors: distinct(dailyRows),
        players: distinct(dailyRows.filter((r) => r.played)),
        newVisitors: distinct(dailyRows.filter((r) => r.first_seen >= startMs)),
        returningVisitors: distinct(dailyRows.filter((r) => r.first_seen < startMs)),
        guests: distinct(dailyRows.filter((r) => r.kind === 'guest')),
        accounts: distinct(dailyRows.filter((r) => r.kind === 'account')),
        matches: matchRows.length,
        completed: completed.length,
        completionRate: matchRows.length ? (completed.length / matchRows.length) * 100 : null,
        noActions: matchRows.filter((m) => !m.actions).length,
        unfinished: matchRows.length - completed.length,
        forfeits: completed.filter((m) => m.forfeit).length,
        dormant: matchRows.filter((m) => !m.finished && time - m.lastActivity > DAY).length,
        playerSeconds: dailyRows.reduce((s, r) => s + r.seconds, 0),
        avgMatchSeconds: durations.length ? durations.reduce((s, n) => s + n, 0) / durations.length : null,
        medianMatchSeconds: median,
        timedMatches: durations.length,
        historicalMatches: 0,
        actions: matchRows.reduce((s, m) => s + (m.actions || 0), 0),
        errors: matchRows.reduce((s, m) => s + (m.errors || 0), 0),
      },
      trend,
      countries: group('country'),
      platforms: group('platform'),
      modes: group('mode'),
      recent: matchRows.slice(0, 25).map((m) => ({
        started: m.started,
        mode: m.mode,
        status: m.finished ? (m.forfeit ? 'forfeit' : 'finished') : 'unfinished',
        duration: m.finished ? Math.max(0, (m.finished - m.started) / 1000) : null,
        actions: m.actions || 0,
        errors: m.errors || 0,
      })),
    };
  };

  const timer = setInterval(flush, 10000);
  if (typeof timer.unref === 'function') timer.unref();

  return { pulse, recordDeal, summary, flush, stop: () => clearInterval(timer) };
}

export type Stats = ReturnType<typeof createStats>;
