import { describe, expect, it } from 'vitest';
import { chooseMove } from './bot';
import {
  Card,
  GameState,
  Move,
  applyMove,
  createDeck,
  deal,
  isLegal,
  legalMoves,
  takeCount,
} from './engine';

const deck = createDeck();
// в тестах пишем JS/QH/KD/AC, в движке это 11S/12H/13D/14C
const FACES: Record<string, string> = { J: '11', Q: '12', K: '13', A: '14' };
const real = (id: string) => id.replace(/^[JQKA]/, (face) => FACES[face]);
const c = (id: string): Card => {
  const card = deck.find((x) => x.id === real(id));
  if (!card) throw new Error(`нет карты ${id}`);
  return card;
};
const cards = (...ids: string[]) => ids.map(c);
const play = (...ids: string[]): Move => ({ type: 'play', cards: ids.map(real) });

function state(hands: string[][], pile: string[], turn = 0): GameState {
  return {
    hands: hands.map((h) => cards(...h)),
    pile: cards(...pile),
    turn,
    finished: [],
    phase: 'playing',
    loser: null,
    log: [],
  };
}

function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('раздача', () => {
  it('в колоде 20 карт от десятки до туза', () => {
    expect(deck).toHaveLength(20);
    expect(new Set(deck.map((x) => x.id)).size).toBe(20);
    expect(Math.min(...deck.map((x) => x.rank))).toBe(10);
  });

  it.each([
    [2, [10, 10]],
    [3, [6, 7, 7]],
    [4, [5, 5, 5, 5]],
    [5, [4, 4, 4, 4, 4]],
  ])('%i игроков получают все карты поровну', (n, sizes) => {
    const s = deal(n, seeded(n));
    expect(s.hands.map((h) => h.length).sort()).toEqual(sizes);
  });

  it('первым ходит владелец 10 пик', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = deal(4, seeded(seed));
      expect(s.hands[s.turn].some((x) => x.id === '10S')).toBe(true);
    }
  });

  it('не принимает 1 или 6 игроков', () => {
    expect(() => deal(1)).toThrow();
    expect(() => deal(6)).toThrow();
  });
});

describe('первый ход', () => {
  it('только с 10 пик', () => {
    const hand = cards('10S', '10H', 'JS', 'AS');
    expect(legalMoves(hand, [])).toEqual([play('10S')]);
  });

  it('с четырьмя десятками можно выложить все сразу', () => {
    const hand = cards('10S', '10H', '10D', '10C', 'AS');
    expect(isLegal(hand, [], play('10S', '10H', '10D', '10C'))).toBe(true);
    expect(isLegal(hand, [], play('10H'))).toBe(false);
  });
});

describe('обычный ход', () => {
  const pile = cards('10S', 'QH');

  it('можно положить карту того же ранга или старше', () => {
    const hand = cards('JS', 'QS', 'KS', 'AS');
    expect(isLegal(hand, pile, play('QS'))).toBe(true);
    expect(isLegal(hand, pile, play('KS'))).toBe(true);
    expect(isLegal(hand, pile, play('JS'))).toBe(false);
  });

  it('две одинаковые за ход положить нельзя', () => {
    const hand = cards('KS', 'KH');
    expect(isLegal(hand, pile, play('KS', 'KH'))).toBe(false);
  });

  it('три карты — только на карту того же ранга', () => {
    expect(isLegal(cards('QS', 'QD', 'QC'), pile, play('QS', 'QD', 'QC'))).toBe(true);
    expect(isLegal(cards('KS', 'KD', 'KC'), pile, play('KS', 'KD', 'KC'))).toBe(false);
  });

  it('три десятки кладутся на 10 пик', () => {
    const hand = cards('10H', '10D', '10C');
    expect(isLegal(hand, cards('10S'), play('10H', '10D', '10C'))).toBe(true);
  });

  it('четыре карты — только старше верхней', () => {
    const kings = cards('KS', 'KH', 'KD', 'KC');
    expect(isLegal(kings, pile, play('KS', 'KH', 'KD', 'KC'))).toBe(true);
    const jacks = cards('JS', 'JH', 'JD', 'JC');
    expect(isLegal(jacks, pile, play('JS', 'JH', 'JD', 'JC'))).toBe(false);
  });
});

describe('взятие карт', () => {
  it('берутся три верхние карты', () => {
    const s = applyMove(state([['JS'], ['AS']], ['10S', 'JH', 'QH', 'KH', 'AH']), {
      type: 'take',
    });
    expect(s.pile).toEqual(cards('10S', 'JH'));
    expect(s.hands[0]).toEqual(cards('JS', 'QH', 'KH', 'AH'));
    expect(s.turn).toBe(1);
  });

  it('10 пик остаётся на столе', () => {
    expect(takeCount(cards('10S', 'JH', 'QH'))).toBe(2);
    const s = applyMove(state([['JS'], ['AS']], ['10S', 'JH', 'QH']), { type: 'take' });
    expect(s.pile).toEqual(cards('10S'));
  });

  it('нельзя брать, если на столе только 10 пик', () => {
    expect(isLegal(cards('JS'), cards('10S'), { type: 'take' })).toBe(false);
    // а положить что-нибудь можно всегда
    expect(legalMoves(cards('JS'), cards('10S')).length).toBeGreaterThan(0);
  });
});

describe('ход и окончание', () => {
  it('ход переходит по кругу, вышедшие пропускаются', () => {
    const s = applyMove(state([['AS', 'AH'], [], ['KS', 'KH']], ['10S', 'JH']), play('AS'));
    expect(s.turn).toBe(2);
  });

  it('оставшийся с картами проигрывает', () => {
    const s = applyMove(state([['AS'], ['JS', 'QS']], ['10S', 'KH']), play('AS'));
    expect(s.phase).toBe('over');
    expect(s.loser).toBe(1);
    expect(s.finished).toEqual([0]);
  });

  it('ничья, если последний игрок сбрасывает всё одним ходом', () => {
    const s = applyMove(state([['AS'], ['AH']], ['10S', 'KH']), play('AS'));
    expect(s.phase).toBe('over');
    expect(s.loser).toBeNull();
    expect(s.finished).toEqual([0, 1]);
    expect(s.pile.at(-1)).toEqual(c('AH'));
  });

  it('недопустимый ход отклоняется', () => {
    expect(() => applyMove(state([['JS'], ['AS']], ['10S', 'KH']), play('JS'))).toThrow();
  });
});

describe('боты', () => {
  it.each([2, 3, 4, 5])('партия из %i ботов всегда заканчивается', (n) => {
    for (let seed = 1; seed <= 300; seed++) {
      const rng = seeded(seed * 31 + n);
      let s = deal(n, rng);
      let moves = 0;
      while (s.phase === 'playing') {
        const level = seed % 2 ? 'normal' : 'easy';
        s = applyMove(s, chooseMove(s.hands[s.turn], s.pile, level, rng));
        if (++moves > 5000) throw new Error(`партия не закончилась, seed ${seed}`);
      }
      const total = s.pile.length + s.hands.reduce((sum, h) => sum + h.length, 0);
      expect(total).toBe(20);
      expect(s.pile[0].id).toBe('10S');
    }
  });
});
