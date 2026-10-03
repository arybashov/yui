import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analyticsIdentity, createStats, PulseClient } from './stats';

const DAY = 86400000;

describe('аналитика YUI (формат админки RRaM)', () => {
  let dir: string;
  let time: number;
  const clock = () => time;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'yui-stats-'));
    time = Date.parse('2026-10-03T12:00:00+03:00');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const client = (over: Partial<PulseClient> = {}): PulseClient => ({
    identity: analyticsIdentity('visitor-aaaaaaaa'),
    platform: 'site',
    country: 'RU',
    visible: true,
    lastSeen: time,
    playing: true,
    mode: 'pvp',
    engaged: true,
    ...over,
  });

  it('пустая статистика отдаёт полный набор полей', () => {
    const stats = createStats(join(dir, 's.json'), clock);
    const s = stats.summary();
    expect(s.days).toBe(30);
    expect(s.trend).toHaveLength(30);
    expect(s.totals).toMatchObject({ visitors: 0, players: 0, matches: 0, completionRate: null });
    expect(s.countries).toEqual([]);
    expect(s.recent).toEqual([]);
    stats.stop();
  });

  it('пульс считает посетителей, игроков и время в партии', () => {
    const stats = createStats(join(dir, 's.json'), clock);
    stats.pulse([client()]);
    time += 30000;
    stats.pulse([client({ lastSeen: time })]);
    const s = stats.summary(7);
    expect(s.totals.visitors).toBe(1);
    expect(s.totals.players).toBe(1);
    expect(s.totals.playerSeconds).toBe(30);
    expect(s.countries[0]).toMatchObject({ key: 'RU', visitors: 1 });
    expect(s.platforms[0]).toMatchObject({ key: 'site' });
    expect(s.modes[0]).toMatchObject({ key: 'pvp' });
    stats.stop();
  });

  it('скрытая вкладка и несколько вкладок не умножают время и посетителей', () => {
    const stats = createStats(join(dir, 's.json'), clock);
    stats.pulse([client(), client(), client({ visible: false })]);
    time += 30000;
    stats.pulse([client({ lastSeen: time }), client({ lastSeen: time })]);
    const s = stats.summary(7);
    expect(s.totals.visitors).toBe(1);
    expect(s.totals.playerSeconds).toBe(30);
    stats.stop();
  });

  it('раздачи считаются партиями: начатые, завершённые, длительность, ходы', () => {
    const stats = createStats(join(dir, 's.json'), clock);
    const person = analyticsIdentity('visitor-aaaaaaaa');
    const started = time;
    stats.recordDeal({
      id: 'ROOM1#1',
      started,
      finished: null,
      lastActivity: time,
      mode: 'pvp',
      participants: [{ player: 0, person, platform: 'site', actions: 3 }],
    });
    time += 120000;
    stats.recordDeal({
      id: 'ROOM1#1',
      started,
      finished: time,
      lastActivity: time,
      mode: 'pvp',
      participants: [{ player: 0, person, platform: 'site', actions: 7 }],
    });
    stats.recordDeal({
      id: 'ROOM1#2',
      started: time,
      finished: null,
      lastActivity: time,
      mode: 'pvp',
      participants: [{ player: 0, person, platform: 'site', actions: 0 }],
    });
    const s = stats.summary(7);
    expect(s.totals.matches).toBe(2);
    expect(s.totals.completed).toBe(1);
    expect(s.totals.unfinished).toBe(1);
    expect(s.totals.noActions).toBe(1);
    expect(s.totals.avgMatchSeconds).toBe(120);
    expect(s.totals.actions).toBe(7);
    expect(s.recent[0].status).toBe('unfinished');
    expect(s.recent[1]).toMatchObject({ status: 'finished', duration: 120, actions: 7 });
    stats.stop();
  });

  it('фильтры площадки и режима работают', () => {
    const stats = createStats(join(dir, 's.json'), clock);
    stats.pulse([client({ platform: 'yandex', mode: 'ai' })]);
    expect(stats.summary(7, 'yandex').totals.visitors).toBe(1);
    expect(stats.summary(7, 'site').totals.visitors).toBe(0);
    expect(stats.summary(7, 'all', 'ai').totals.visitors).toBe(1);
    expect(stats.summary(7, 'all', 'pvp').totals.visitors).toBe(0);
    stats.stop();
  });

  it('данные переживают перезапуск сервера', () => {
    const file = join(dir, 's.json');
    const first = createStats(file, clock);
    first.pulse([client()]);
    first.flush();
    first.stop();
    time += DAY;
    const second = createStats(file, clock);
    const s = second.summary(7);
    expect(s.totals.visitors).toBe(1);
    expect(s.totals.returningVisitors + s.totals.newVisitors).toBe(1);
    second.stop();
  });

  it('без идентификатора посетителя ничего не учитывается', () => {
    expect(analyticsIdentity('')).toBeNull();
    expect(analyticsIdentity(undefined)).toBeNull();
    const stats = createStats(join(dir, 's.json'), clock);
    stats.pulse([client({ identity: null })]);
    expect(stats.summary().totals.visitors).toBe(0);
    stats.stop();
  });
});
