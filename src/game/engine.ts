// Правила YUI — «Пан» на 20 картах: 10–туз, стартовая карта — 10 пик.
// Модуль чистый: ни DOM, ни сети, ни таймеров.

export type Suit = 'S' | 'H' | 'D' | 'C';
export type Rank = 10 | 11 | 12 | 13 | 14;

export interface Card {
  id: string;
  rank: Rank;
  suit: Suit;
}

export type Move = { type: 'play'; cards: string[] } | { type: 'take' };

export interface LogEntry {
  player: number;
  type: 'play' | 'take';
  cards: Card[];
}

export interface GameState {
  hands: Card[][];
  /** pile[0] — всегда 10 пик, как только игра началась */
  pile: Card[];
  turn: number;
  /** места в порядке выхода из игры */
  finished: number[];
  phase: 'playing' | 'over';
  /** проигравший; null при phase === 'over' означает ничью */
  loser: number | null;
  log: LogEntry[];
}

export const RANKS: Rank[] = [10, 11, 12, 13, 14];
export const SUITS: Suit[] = ['S', 'H', 'D', 'C'];
export const START_CARD_ID = '10S';
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 5;
export const TAKE_LIMIT = 3;

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) deck.push({ id: `${rank}${suit}`, rank, suit });
  }
  return deck;
}

export function shuffle<T>(items: T[], rng: () => number = Math.random): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function sortHand(hand: Card[]): Card[] {
  return hand
    .slice()
    .sort((a, b) => a.rank - b.rank || SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit));
}

export function deal(numPlayers: number, rng: () => number = Math.random): GameState {
  if (numPlayers < MIN_PLAYERS || numPlayers > MAX_PLAYERS) {
    throw new Error(`Игроков должно быть от ${MIN_PLAYERS} до ${MAX_PLAYERS}`);
  }
  const deck = shuffle(createDeck(), rng);
  const hands: Card[][] = Array.from({ length: numPlayers }, () => []);
  // при неровной раздаче лишняя карта достаётся случайному игроку
  const first = Math.floor(rng() * numPlayers);
  deck.forEach((card, i) => hands[(first + i) % numPlayers].push(card));
  return {
    hands: hands.map(sortHand),
    pile: [],
    turn: hands.findIndex((hand) => hand.some((c) => c.id === START_CARD_ID)),
    finished: [],
    phase: 'playing',
    loser: null,
    log: [],
  };
}

/** Сколько карт заберёт игрок, если решит брать: 10 пик всегда остаётся на столе. */
export function takeCount(pile: Card[]): number {
  return Math.max(0, Math.min(TAKE_LIMIT, pile.length - 1));
}

export function legalMoves(hand: Card[], pile: Card[]): Move[] {
  const moves: Move[] = [];

  if (pile.length === 0) {
    if (!hand.some((c) => c.id === START_CARD_ID)) return moves;
    moves.push({ type: 'play', cards: [START_CARD_ID] });
    const tens = hand.filter((c) => c.rank === 10);
    if (tens.length === 4) {
      const others = tens.filter((c) => c.id !== START_CARD_ID).map((c) => c.id);
      moves.push({ type: 'play', cards: [START_CARD_ID, ...others] });
    }
    return moves;
  }

  const top = pile[pile.length - 1];
  for (const rank of RANKS) {
    if (rank < top.rank) continue;
    const group = hand.filter((c) => c.rank === rank);
    for (const card of group) moves.push({ type: 'play', cards: [card.id] });
    // три карты — только на карту того же ранга, четыре — только на младшую
    if (group.length === 3 && rank === top.rank) {
      moves.push({ type: 'play', cards: group.map((c) => c.id) });
    }
    if (group.length === 4 && rank > top.rank) {
      moves.push({ type: 'play', cards: group.map((c) => c.id) });
    }
  }
  if (takeCount(pile) > 0) moves.push({ type: 'take' });
  return moves;
}

function moveKey(move: Move): string {
  return move.type === 'take' ? 'take' : `play:${move.cards.slice().sort().join(',')}`;
}

export function isLegal(hand: Card[], pile: Card[], move: Move): boolean {
  const key = moveKey(move);
  return legalMoves(hand, pile).some((m) => moveKey(m) === key);
}

/** Ход, которым можно сбросить всю руку разом, если такой есть. */
export function finishingMove(hand: Card[], pile: Card[]): Move | undefined {
  return legalMoves(hand, pile).find(
    (m) => m.type === 'play' && m.cards.length === hand.length,
  );
}

export function activeSeats(state: GameState): number[] {
  return state.hands.flatMap((hand, seat) => (hand.length > 0 ? [seat] : []));
}

export function applyMove(state: GameState, move: Move): GameState {
  if (state.phase !== 'playing') throw new Error('Игра окончена');
  const player = state.turn;
  if (!isLegal(state.hands[player], state.pile, move)) throw new Error('Недопустимый ход');

  const hands = state.hands.map((hand) => hand.slice());
  const pile = state.pile.slice();
  const finished = state.finished.slice();
  const log = state.log.slice();

  const play = (seat: number, ids: string[]) => {
    const played = ids.map((id) => hands[seat].find((c) => c.id === id)!);
    hands[seat] = hands[seat].filter((c) => !ids.includes(c.id));
    pile.push(...played);
    log.push({ player: seat, type: 'play', cards: played });
    if (hands[seat].length === 0) finished.push(seat);
  };

  if (move.type === 'take') {
    const n = takeCount(pile);
    const taken = pile.splice(pile.length - n, n);
    hands[player] = sortHand([...hands[player], ...taken]);
    log.push({ player, type: 'take', cards: taken });
  } else {
    play(player, move.cards);
  }

  const active = hands.flatMap((hand, seat) => (hand.length > 0 ? [seat] : []));

  if (active.length === 1) {
    // Последний игрок получает один ход: сбросит всё разом — ничья, иначе он проиграл.
    const last = active[0];
    const out = finishingMove(hands[last], pile);
    if (out && out.type === 'play') {
      play(last, out.cards);
      return { hands, pile, turn: last, finished, phase: 'over', loser: null, log };
    }
    return { hands, pile, turn: last, finished, phase: 'over', loser: last, log };
  }

  let next = player;
  do {
    next = (next + 1) % hands.length;
  } while (hands[next].length === 0);

  return { hands, pile, turn: next, finished, phase: 'playing', loser: null, log };
}
