import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseMove } from './bot';
import { HostSeat, HostSession, PlayerView, matchWinners } from './session';

/** Сетевая партия двух людей, как на сервере; views — последний вид каждого. */
function onlineTable(options: { anyoneRestarts?: boolean; autoNextDealMs?: number } = {}) {
  const views: PlayerView[] = [];
  const seats: HostSeat[] = [0, 1].map((i) => ({
    name: `P${i}`,
    kind: 'remote',
    send: (view) => (views[i] = view),
  }));
  const session = new HostSession(seats, { botLevel: 'normal', ownerSeat: 0, ...options });
  session.start();
  /** доиграть раздачу ходами «как бот» за обоих */
  const finishDeal = () => {
    for (let i = 0; i < 5000 && views[0].phase === 'playing'; i++) {
      const seat = views[0].turn;
      session.handleMove(seat, chooseMove(views[seat].hand, views[seat].pile, 'normal'));
    }
    expect(views[0].phase).toBe('over');
  };
  return { session, views, finishDeal };
}

describe('сетевая партия между раздачами', () => {
  afterEach(() => vi.useRealTimers());

  it('без особых настроек новую раздачу начинает только владелец', () => {
    const { session, views, finishDeal } = onlineTable();
    finishDeal();
    expect(views[1].canRestart).toBe(false);
    session.requestNewDeal(1);
    expect(views[0].dealNo).toBe(1);
  });

  it('на сервере следующую раздачу может начать любой игрок', () => {
    const { session, views, finishDeal } = onlineTable({ anyoneRestarts: true });
    finishDeal();
    expect(views[1].canRestart).toBe(true);
    session.requestNewDeal(1);
    expect(views[0].dealNo).toBe(2);
    expect(views[0].phase).toBe('playing');
  });

  it('если никто не нажал, следующая раздача начинается сама', () => {
    vi.useFakeTimers();
    const { session, views, finishDeal } = onlineTable({ anyoneRestarts: true, autoNextDealMs: 12000 });
    expect(views[0].nextDealIn).toBeNull();
    finishDeal();
    expect(views[1].nextDealIn).toBe(12000);
    vi.advanceTimersByTime(12000);
    expect(views[1].dealNo).toBe(2);
    expect(views[1].nextDealIn).toBeNull();
    session.leave();
  });

  it('нажатие отменяет отсчёт, и лишней раздачи потом не будет', () => {
    vi.useFakeTimers();
    const { session, views, finishDeal } = onlineTable({ anyoneRestarts: true, autoNextDealMs: 12000 });
    finishDeal();
    session.requestNewDeal(0);
    expect(views[0].dealNo).toBe(2);
    vi.advanceTimersByTime(20000);
    expect(views[0].dealNo).toBe(2);
    session.leave();
  });

  it('сдавшийся проигрывает раздачу и получает букву, потом раздача идёт дальше', () => {
    vi.useFakeTimers();
    const { session, views } = onlineTable({ anyoneRestarts: true, autoNextDealMs: 12000 });
    session.handleResign(1);
    expect(views[0].phase).toBe('over');
    expect(views[0].loser).toBe(1);
    expect(views[0].players[1].losses).toBe(1);
    expect(views[0].log.at(-1)).toEqual({ player: 1, type: 'resign', cards: [] });
    // повторная сдача после конца раздачи ничего не меняет
    session.handleResign(1);
    expect(views[0].players[1].losses).toBe(1);
    vi.advanceTimersByTime(12000);
    expect(views[0].dealNo).toBe(2);
    expect(views[0].phase).toBe('playing');
    session.leave();
  });
});

describe('победы и победитель матча', () => {
  it('побеждает тот, у кого больше выигранных раздач', () => {
    expect(matchWinners([1, 3, 0], [3, 1, 2], 0)).toEqual([1]);
  });

  it('при равных победах — у кого меньше букв', () => {
    expect(matchWinners([2, 2, 0], [1, 2, 3], 2)).toEqual([0]);
  });

  it('при полном равенстве победа общая, проигравший в победители не попадает', () => {
    expect(matchWinners([3, 1, 1], [3, 1, 1], 0)).toEqual([1, 2]);
  });

  it('раздачу выигрывает вышедший первым, к концу матча счёт побед сходится с числом раздач', () => {
    const { session, views, finishDeal } = onlineTable();
    for (let n = 0; n < 50 && views[0].matchLoser === null; n++) {
      if (n > 0) session.requestNewDeal(0);
      finishDeal();
    }
    const view = views[0];
    expect(view.matchLoser).not.toBeNull();
    const wins = view.players.map((p) => p.wins ?? 0);
    // с двумя игроками у каждой раздачи без сдачи ровно один победитель
    expect(wins[0] + wins[1]).toBe(view.dealNo);
    expect(view.matchWinners).toEqual([1 - view.matchLoser!]);
    session.requestNewDeal(0);
    expect(views[0].players.map((p) => p.wins)).toEqual([0, 0]);
    expect(views[0].matchWinners).toEqual([]);
  });
});
