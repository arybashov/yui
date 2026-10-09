import { Card, LogEntry, Move, createDeck, sortHand, takeCount } from '../game/engine';
import { PlayerView, Session } from '../game/session';
import { LessonText } from '../i18n/types';
import { Store } from '../store';

// Обучение — цепочка коротких позиций на обычном столе. В каждой нужно сделать
// один ход, который показывает правило; партия при этом не разыгрывается.
// Тексты шагов лежат в словарях (i18n), в том же порядке, что и позиции здесь.

interface Lesson {
  /** карты записаны как 10S, JH, QD, KC, AS */
  hand: string;
  pile: string;
  teacherCards: number;
  /** сколько верхних карт стопки показать в журнале как ход учителя */
  teacherPlayed: number;
  accept: (move: Move) => boolean;
}

const isPlay = (move: Move, count: number) => move.type === 'play' && move.cards.length === count;
const isTake = (move: Move) => move.type === 'take';

const LESSONS: Lesson[] = [
  // первый ход — только с 10 пик
  { hand: '10S JH QD KC AS', pile: '', teacherCards: 5, teacherPlayed: 0, accept: (m) => isPlay(m, 1) },
  // карта того же ранга или старше
  { hand: 'JD QC KS AH', pile: '10S QH', teacherCards: 4, teacherPlayed: 1, accept: (m) => isPlay(m, 1) },
  // ходить нечем — берём три карты
  { hand: '10D JS QS', pile: '10S JH KD AC', teacherCards: 3, teacherPlayed: 1, accept: isTake },
  // 10 пик не берут
  { hand: 'QS QD', pile: '10S KH AD', teacherCards: 4, teacherPlayed: 1, accept: isTake },
  // четыре одинаковые разом
  { hand: 'KS KH KD KC AS', pile: '10S JH', teacherCards: 5, teacherPlayed: 1, accept: (m) => isPlay(m, 4) },
  // три десятки на 10 пик
  { hand: '10H 10D 10C JS', pile: '10S', teacherCards: 6, teacherPlayed: 0, accept: (m) => isPlay(m, 3) },
  // сбросить последнюю карту
  { hand: 'AS', pile: '10S KH', teacherCards: 3, teacherPlayed: 1, accept: (m) => isPlay(m, 1) },
];

const FACES: Record<string, string> = { J: '11', Q: '12', K: '13', A: '14' };
const DECK = createDeck();

function parseCards(list: string): Card[] {
  return list
    .split(' ')
    .filter(Boolean)
    .map((token) => {
      const id = token.replace(/^[JQKA]/, (face) => FACES[face]);
      const card = DECK.find((c) => c.id === id);
      if (!card) throw new Error(`Нет карты ${token}`);
      return card;
    });
}

export interface CoachState {
  step: number;
  total: number;
  /** какой из текстов шага показывать: задание, подсказку после неверного хода или итог */
  message: keyof LessonText;
  /** нужный ход сделан, можно идти дальше */
  solved: boolean;
  finished: boolean;
}

const TEACHER = 1;
const STUDENT = 0;

export class TutorialSession implements Session {
  readonly coach = new Store<CoachState>({
    step: 0,
    total: LESSONS.length,
    message: 'text',
    solved: false,
    finished: false,
  });
  private hand: Card[] = [];
  private pile: Card[] = [];
  private log: LogEntry[] = [];
  private listeners = new Set<(view: PlayerView) => void>();

  constructor(private names: { you: string; teacher: string }) {
    this.load(0);
  }

  private load(step: number): void {
    const lesson = LESSONS[step];
    this.hand = sortHand(parseCards(lesson.hand));
    this.pile = parseCards(lesson.pile);
    this.log =
      lesson.teacherPlayed > 0
        ? [{ player: TEACHER, type: 'play', cards: this.pile.slice(-lesson.teacherPlayed) }]
        : [];
    this.coach.set({ step, message: 'text', solved: false });
    this.emit();
  }

  private view(): PlayerView {
    const { step, solved } = this.coach.get();
    const player = { isBot: false, away: false, place: null, losses: 0, wins: 0 };
    return {
      seat: STUDENT,
      players: [
        { ...player, name: this.names.you, count: this.hand.length },
        { ...player, name: this.names.teacher, isBot: true, count: LESSONS[step].teacherCards },
      ],
      hand: this.hand,
      pile: this.pile,
      turn: solved ? TEACHER : STUDENT,
      phase: 'playing',
      loser: null,
      log: this.log,
      moveNo: this.log.length,
      dealNo: 1,
      matchLoser: null,
      canRestart: false,
      nextDealIn: null,
    };
  }

  private emit(): void {
    const view = this.view();
    this.listeners.forEach((listener) => listener(view));
  }

  subscribe(listener: (view: PlayerView) => void): () => void {
    this.listeners.add(listener);
    listener(this.view());
    return () => this.listeners.delete(listener);
  }

  move(move: Move): void {
    const { step, solved } = this.coach.get();
    if (solved) return;
    if (!LESSONS[step].accept(move)) {
      this.coach.set({ message: 'retry' });
      return;
    }
    if (move.type === 'take') {
      const n = takeCount(this.pile);
      const taken = this.pile.slice(-n);
      this.pile = this.pile.slice(0, -n);
      this.hand = sortHand([...this.hand, ...taken]);
      this.log = [...this.log, { player: STUDENT, type: 'take', cards: taken }];
    } else {
      const played = this.hand.filter((c) => move.cards.includes(c.id));
      this.hand = this.hand.filter((c) => !move.cards.includes(c.id));
      this.pile = [...this.pile, ...played];
      this.log = [...this.log, { player: STUDENT, type: 'play', cards: played }];
    }
    this.coach.set({ message: 'done', solved: true });
    this.emit();
  }

  next(): void {
    const { step, total, solved } = this.coach.get();
    if (!solved) return;
    if (step + 1 < total) this.load(step + 1);
    else this.coach.set({ finished: true });
  }

  newDeal(): void {
    // в обучении раздач нет
  }

  leave(): void {
    this.listeners.clear();
  }
}
