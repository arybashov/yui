import { GAME_TITLE } from '../config';
import { Card, LogEntry, Move, createDeck, sortHand, takeCount } from '../game/engine';
import { PlayerView, Session } from '../game/session';
import { Store } from '../store';

// Обучение — цепочка коротких позиций на обычном столе. В каждой нужно сделать
// один ход, который показывает правило; партия при этом не разыгрывается.

interface Lesson {
  text: string;
  /** карты записаны как 10S, JH, QD, KC, AS */
  hand: string;
  pile: string;
  teacherCards: number;
  /** сколько верхних карт стопки показать в журнале как ход учителя */
  teacherPlayed: number;
  accept: (move: Move) => boolean;
  retry: string;
  done: string;
}

const isPlay = (move: Move, count: number) => move.type === 'play' && move.cards.length === count;
const isTake = (move: Move) => move.type === 'take';

const LESSONS: Lesson[] = [
  {
    text: 'Карты розданы. Первым ходит тот, у кого 10♠, и только с неё. Она у вас: нажмите на 10♠.',
    hand: '10S JH QD KC AS',
    pile: '',
    teacherCards: 5,
    teacherPlayed: 0,
    accept: (move) => isPlay(move, 1),
    retry: 'Первый ход — только 10♠.',
    done: '10♠ легла на стол и останется там до конца раздачи.',
  },
  {
    text: 'Учитель положил даму. Масти не важны: кладите карту того же ранга или старше. Валет младше дамы — он затемнён. Нажмите на любую светлую карту.',
    hand: 'JD QC KS AH',
    pile: '10S QH',
    teacherCards: 4,
    teacherPlayed: 1,
    accept: (move) => isPlay(move, 1),
    retry: 'Положите одну карту: даму, короля или туза.',
    done: 'Верно. Чем старше карта, тем труднее сопернику её перебить.',
  },
  {
    text: 'На столе туз, а туза у вас нет — ходить нечем. В таком случае берут три верхние карты стопки. Нажмите «Взять 3 карты».',
    hand: '10D JS QS',
    pile: '10S JH KD AC',
    teacherCards: 3,
    teacherPlayed: 1,
    accept: isTake,
    retry: 'Нажмите «Взять 3 карты».',
    done: 'Карты у вас, ход переходит сопернику. Брать можно и по желанию — даже когда есть чем ходить.',
  },
  {
    text: '10♠ никогда не берут. Сейчас поверх неё только две карты — значит, возьмёте две. Нажмите «Взять 2 карты».',
    hand: 'QS QD',
    pile: '10S KH AD',
    teacherCards: 4,
    teacherPlayed: 1,
    accept: isTake,
    retry: 'Нажмите «Взять 2 карты».',
    done: 'На столе осталась одна 10♠. Теперь сопернику брать нечего — он обязан положить карту.',
  },
  {
    text: 'У вас четыре короля. Четыре одинаковые карты можно положить за один ход на любую младшую карту. Нажмите кнопку «Положить 4 короля».',
    hand: 'KS KH KD KC AS',
    pile: '10S JH',
    teacherCards: 5,
    teacherPlayed: 1,
    accept: (move) => isPlay(move, 4),
    retry: 'Можно и по одной, но попробуйте кнопку «Положить 4 короля».',
    done: 'Четыре карты ушли одним ходом. Две одинаковые сразу положить нельзя — только одну, три или четыре.',
  },
  {
    text: 'Три карты за ход кладут только на карту того же ранга. На столе 10♠, у вас три остальные десятки — нажмите «Положить 3 десятки».',
    hand: '10H 10D 10C JS',
    pile: '10S',
    teacherCards: 6,
    teacherPlayed: 0,
    accept: (move) => isPlay(move, 3),
    retry: 'Нажмите кнопку «Положить 3 десятки».',
    done: 'Точно так же три дамы кладутся на даму, три туза — на туза.',
  },
  {
    text: 'Цель — сбросить все карты. У вас остался один туз: нажмите на него и выйдите из игры.',
    hand: 'AS',
    pile: '10S KH',
    teacherCards: 3,
    teacherPlayed: 1,
    accept: (move) => isPlay(move, 1),
    retry: 'Нажмите на туза.',
    done: `Вы вышли первым. Кто остался с картами последним, получает букву: ${GAME_TITLE.split('').join(', ')}. Собравший ${GAME_TITLE} проигрывает матч.`,
  },
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
  text: string;
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
    text: LESSONS[0].text,
    solved: false,
    finished: false,
  });
  private hand: Card[] = [];
  private pile: Card[] = [];
  private log: LogEntry[] = [];
  private listeners = new Set<(view: PlayerView) => void>();

  constructor() {
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
    this.coach.set({ step, text: lesson.text, solved: false });
    this.emit();
  }

  private view(): PlayerView {
    const { step, solved } = this.coach.get();
    return {
      seat: STUDENT,
      players: [
        { name: 'Вы', isBot: false, count: this.hand.length, place: null, losses: 0 },
        { name: 'Учитель', isBot: true, count: LESSONS[step].teacherCards, place: null, losses: 0 },
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
    const lesson = LESSONS[step];
    if (!lesson.accept(move)) {
      this.coach.set({ text: lesson.retry });
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
    this.coach.set({ text: lesson.done, solved: true });
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
