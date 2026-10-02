import { Card, Move, finishingMove, legalMoves } from './engine';

export type BotLevel = 'easy' | 'normal';

type PlayMove = Extract<Move, { type: 'play' }>;

const EASY_MISTAKE_RATE = 0.3;
/** Как часто бот берёт карты, хотя мог бы ходить, — когда в руке есть карты младше верхней.
 *  Такие карты не сыграть, пока стопку не разберут; если только ходить, двое ботов
 *  могут гонять старшие карты по кругу бесконечно. */
const DIG_RATE = 0.3;

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

  const top = pile[pile.length - 1];
  const canTake = moves.some((m) => m.type === 'take');
  if (canTake && hand.some((c) => c.rank < top.rank) && rng() < DIG_RATE) {
    return { type: 'take' };
  }

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
