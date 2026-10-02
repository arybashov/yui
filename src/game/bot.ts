import { Card, Move, finishingMove, legalMoves } from './engine';

export type BotLevel = 'easy' | 'normal';

type PlayMove = Extract<Move, { type: 'play' }>;

const EASY_MISTAKE_RATE = 0.3;

function rankOf(hand: Card[], move: PlayMove): number {
  return hand.find((c) => c.id === move.cards[0])!.rank;
}

export function chooseMove(
  hand: Card[],
  pile: Card[],
  level: BotLevel,
  rng: () => number = Math.random,
): Move {
  const moves = legalMoves(hand, pile);
  const plays = moves.filter((m): m is PlayMove => m.type === 'play');
  if (plays.length === 0) return { type: 'take' };

  const finish = finishingMove(hand, pile);
  if (finish) return finish;

  // Простой бот время от времени ошибается; совсем случайная игра затягивает партию на сотни ходов.
  if (level === 'easy' && rng() < EASY_MISTAKE_RATE) {
    return plays[Math.floor(rng() * plays.length)];
  }

  // Младшие карты сбросить труднее всего, поэтому кладём самый низкий
  // допустимый ранг и как можно больше карт этого ранга за ход.
  const lowest = Math.min(...plays.map((m) => rankOf(hand, m)));
  const candidates = plays.filter((m) => rankOf(hand, m) === lowest);
  const most = Math.max(...candidates.map((m) => m.cards.length));
  const best = candidates.filter((m) => m.cards.length === most);
  return best[Math.floor(rng() * best.length)];
}
