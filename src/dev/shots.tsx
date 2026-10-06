import { useMemo } from 'react';
import { Card, LogEntry, Move, Rank, Suit } from '../game/engine';
import { PlayerInfo, PlayerView, Session, botSeatName } from '../game/session';
import { currentLang, useT } from '../i18n';
import { Table } from '../ui/Table';

// Постановочные кадры для скриншотов каталога (только dev-сервер: ?shot=<сцена>&lang=ru|en).
// Стол рисуется настоящим компонентом Table по заранее заданной позиции — так
// скриншоты показывают реальный интерфейс игры, но в выгодный момент.

const FACES: Record<string, Rank> = { J: 11, Q: 12, K: 13, A: 14 };

function card(token: string): Card {
  const suit = token.slice(-1) as Suit;
  const value = token.slice(0, -1);
  const rank = (FACES[value] ?? Number(value)) as Rank;
  return { id: `${rank}${suit}`, rank, suit };
}

const cards = (list: string) => list.split(' ').filter(Boolean).map(card);

const NAMES = {
  ru: { you: 'Вы', a: 'Аня', b: 'Макс', c: 'Оля' },
  en: { you: 'You', a: 'Anna', b: 'Max', c: 'Olga' },
};

function player(name: string, count: number, extra: Partial<PlayerInfo> = {}): PlayerInfo {
  return { name, isBot: false, away: false, count, place: null, losses: 0, ...extra };
}
const bot = (n: number, count: number, extra: Partial<PlayerInfo> = {}) =>
  player(botSeatName(n), count, { isBot: true, ...extra });

function play(seat: number, list: string): LogEntry {
  return { player: seat, type: 'play', cards: cards(list) };
}

function view(v: Partial<PlayerView> & Pick<PlayerView, 'players' | 'hand' | 'pile'>): PlayerView {
  return {
    seat: 0,
    turn: 0,
    phase: 'playing',
    loser: null,
    log: [],
    moveNo: v.log?.length ?? 0,
    dealNo: 1,
    matchLoser: null,
    canRestart: true,
    nextDealIn: null,
    ...v,
  };
}

type Scene = { view: PlayerView; coach?: 'four' };

function scenes(): Record<string, Scene> {
  const n = NAMES[currentLang()];
  return {
    // начало раздачи за столом на пятерых: первым ходит владелец 10♠
    start: {
      view: view({
        players: [player(n.you, 4), bot(1, 4), bot(2, 4), bot(3, 4), bot(4, 4)],
        hand: cards('10S JH QS KD'),
        pile: [],
      }),
    },
    // середина партии: на столе дама, можно ходить дамой и старше
    play: {
      view: view({
        players: [player(n.you, 7), bot(1, 5), bot(2, 5)],
        hand: cards('10D JC QS KH KD AC AS'),
        pile: cards('10S JH QD'),
        log: [play(1, 'JH'), play(2, 'QD')],
        dealNo: 2,
      }),
    },
    // полка: четыре короля кладутся разом
    four: {
      view: view({
        players: [player(n.you, 6), bot(1, 6), bot(2, 5)],
        hand: cards('QH KS KH KD KC AS'),
        pile: cards('10S 10H JD'),
        log: [play(2, '10H'), play(1, 'JD')],
      }),
    },
    // ходить нечем — берём три верхние карты
    take: {
      view: view({
        players: [player(n.you, 4), bot(1, 3), bot(2, 4), bot(3, 2)],
        hand: cards('10H JS QD KC'),
        pile: cards('10S JD QH KS AH AD'),
        log: [play(1, 'KS'), play(2, 'AH'), play(3, 'AD')],
        dealNo: 3,
      }),
    },
    // обучение: шаг про четыре одинаковые карты
    tutorial: {
      view: view({
        players: [player(n.you, 5), bot(1, 5)],
        hand: cards('KS KH KD KC AS'),
        pile: cards('10S JH'),
        log: [play(1, 'JH')],
      }),
      coach: 'four',
    },
    // онлайн с друзьями: ходит соперник, у двоих уже есть буквы YUI
    online: {
      view: view({
        players: [
          player(n.you, 5, { losses: 1 }),
          player(n.a, 3),
          player(n.b, 6, { losses: 2 }),
          player(n.c, 2),
        ],
        hand: cards('10C JS QS KD AS'),
        pile: cards('10S 10D JH JC QH QC KS'),
        log: [play(1, 'QC'), play(2, 'KS')],
        turn: 3,
        dealNo: 4,
      }),
    },
    // конец раздачи: вы вышли первым
    result: {
      view: view({
        players: [
          player(n.you, 0, { place: 1 }),
          player(n.a, 0, { place: 2, losses: 1 }),
          player(n.b, 3, { losses: 2 }),
        ],
        hand: [],
        pile: cards('10S JH QD KS AD AC'),
        log: [play(0, 'AC')],
        phase: 'over',
        loser: 2,
        dealNo: 5,
      }),
    },
    // то же в сетевой игре: следующая раздача начнётся сама (для проверки, не для каталога)
    'result-online': {
      view: view({
        players: [
          player(n.you, 0, { place: 1 }),
          player(n.a, 3, { losses: 1 }),
        ],
        hand: [],
        pile: cards('10S JH QD KS AD AC'),
        log: [play(0, 'AC')],
        phase: 'over',
        loser: 1,
        dealNo: 2,
        nextDealIn: 12000,
      }),
    },
  };
}

class StaticSession implements Session {
  constructor(private v: PlayerView) {}
  subscribe(listener: (view: PlayerView) => void): () => void {
    listener(this.v);
    return () => undefined;
  }
  move(_move: Move): void {}
  newDeal(): void {}
  leave(): void {}
}

export function ShotScene({ name }: { name: string }) {
  const t = useT();
  const scene = useMemo(() => scenes()[name], [name]);
  const session = useMemo(() => (scene ? new StaticSession(scene.view) : null), [scene]);
  if (!scene || !session) return <p style={{ color: 'white' }}>Unknown scene: {name}</p>;
  const coach =
    scene.coach === 'four'
      ? { title: t.tutorialTitle(5, t.lessons.length), text: t.lessons[4].text, nextLabel: t.next }
      : undefined;
  return <Table session={session} onExit={() => undefined} coach={coach} />;
}

export const SHOT_SCENES = ['start', 'play', 'four', 'take', 'tutorial', 'online', 'result'];
