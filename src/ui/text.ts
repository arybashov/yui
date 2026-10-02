import { Card, LogEntry, Rank, Suit } from '../game/engine';

// те же обозначения, что нарисованы на самих картах
const RANK_LABELS: Record<Rank, string> = { 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const SUIT_SYMBOLS: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

/** Название ранга после «три» и «четыре»: «Положить 4 короля». */
const RANK_GROUP_NAMES: Record<Rank, string> = {
  10: 'десятки',
  11: 'валета',
  12: 'дамы',
  13: 'короля',
  14: 'туза',
};

export const rankGroupName = (rank: Rank) => RANK_GROUP_NAMES[rank];
export const rankLabel = (rank: Rank) => RANK_LABELS[rank];
export const suitSymbol = (suit: Suit) => SUIT_SYMBOLS[suit];
export const cardLabel = (card: Card) => `${rankLabel(card.rank)}${suitSymbol(card.suit)}`;

export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export const cardsWord = (n: number) => `${n} ${plural(n, 'карту', 'карты', 'карт')}`;

export function describeAction(entry: LogEntry, name: string, isYou: boolean): string {
  if (entry.type === 'take') {
    return `${isYou ? 'Вы берёте' : `${name} берёт`} ${cardsWord(entry.cards.length)}`;
  }
  return `${isYou ? 'Вы кладёте' : `${name} кладёт`} ${entry.cards.map(cardLabel).join(' ')}`;
}
