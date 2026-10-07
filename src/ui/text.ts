import { Card, LogEntry, Rank, Suit } from '../game/engine';
import { PlayerInfo, botNumber } from '../game/session';
import { Dict } from '../i18n';

// те же обозначения, что нарисованы на самих картах
const RANK_LABELS: Record<Rank, string> = { 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const SUIT_SYMBOLS: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

export const rankLabel = (rank: Rank) => RANK_LABELS[rank];
export const cardLabel = (card: Card) => `${rankLabel(card.rank)}${SUIT_SYMBOLS[card.suit]}`;

/** Имя игрока на экране: боты называются на языке интерфейса. */
export function playerName(player: PlayerInfo, t: Dict): string {
  const bot = botNumber(player);
  if (bot !== null) return t.bot(bot);
  return player.away ? `${player.name} ${t.botSuffix}` : player.name;
}

export function describeAction(entry: LogEntry, name: string, isYou: boolean, t: Dict): string {
  if (entry.type === 'resign') return isYou ? t.logYouResign : t.logResign(name);
  if (entry.type === 'take') {
    return isYou ? t.logYouTake(entry.cards.length) : t.logTake(name, entry.cards.length);
  }
  const cards = entry.cards.map(cardLabel).join(' ');
  return isYou ? t.logYouPlay(cards) : t.logPlay(name, cards);
}
