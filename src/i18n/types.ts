import { Rank } from '../game/engine';

/** Коды сетевых ошибок: сервер и сетевой слой сообщают код, а текст подбирает клиент на своём языке. */
export type NetError =
  | 'room-not-found'
  | 'game-started'
  | 'room-full'
  | 'game-over'
  | 'server-full'
  | 'bad-message'
  | 'cant-create'
  | 'cant-connect'
  | 'connection-error'
  | 'lost-server'
  | 'lost-host'
  | 'host-closed';

export interface LessonText {
  text: string;
  retry: string;
  done: string;
}

/** Все тексты интерфейса на одном языке. */
export interface Dict {
  /** название языка на нём самом — подпись флага для программ чтения с экрана */
  langName: string;
  subtitle: string;

  yourName: string;
  defaultName: string;
  /** экран настроек — как в «Городках»: строки-переключатели с пояснением */
  settings: string;
  soundLabel: string;
  soundNote: string;
  hapticsLabel: string;
  hapticsNote: string;
  /** переключатель «интерфейс на английском»; подпись — на текущем языке интерфейса */
  langLabel: string;
  langNote: string;
  howToPlay: string;
  done: string;
  /** номер сборки внизу настроек, как в «Городках» */
  buildTag: (version: string) => string;
  /** меню паузы во время партии */
  pause: string;
  paused: string;
  resume: string;

  vsBots: string;
  opponents: string;
  bots: string;
  botEasy: string;
  botNormal: string;
  play: string;

  online: string;
  createRoom: string;
  roomCode: string;
  join: string;

  tutorial: string;
  rules: string;
  rulesItems: string[];
  gotIt: string;

  bot: (n: number) => string;
  /** пометка у игрока, за которого временно играет бот */
  botSuffix: string;
  youSuffix: string;

  dealing: string;
  deal: (n: number) => string;
  yourLetters: string;
  exit: string;
  toMenu: string;
  back: string;

  statusDealOver: string;
  statusYourTurn: (rank: string) => string;
  statusFirstMove: string;
  statusDone: (button: string) => string;
  statusYouOut: (place: number) => string;
  statusTurnOf: (name: string) => string;

  playGroup: (count: number, rank: Rank) => string;
  take: (count: number) => string;
  takeCards: string;
  noCardsLeft: string;
  cardsCount: (count: number) => string;
  wentOut: (place: number) => string;
  leftWithCards: string;
  hiddenPile: string;

  logYouPlay: (cards: string) => string;
  logPlay: (name: string, cards: string) => string;
  logYouTake: (count: number) => string;
  logTake: (name: string, count: number) => string;

  resultMatchLostYou: (title: string) => string;
  resultMatchLost: (name: string, title: string) => string;
  resultDraw: string;
  resultYouLost: string;
  resultWin: string;
  resultYouPlace: (place: number) => string;
  colPlayer: string;
  colOutcome: string;
  colLetters: string;
  newDeal: string;
  newMatch: string;
  ownerStartsDeal: string;
  ownerStartsMatch: string;

  tutorialTitle: (step: number, total: number) => string;
  next: string;
  finish: string;
  teacher: string;
  you: string;
  tutorialDone: string;
  tutorialDoneText: string;
  playWithBot: string;
  lessons: LessonText[];

  room: string;
  copyLink: string;
  linkCopied: string;
  shareHint: string;
  shareHintHost: string;
  players: string;
  addBots: string;
  waitingPlayers: string;
  startGame: (players: number) => string;
  waitingOwner: string;
  creatingRoom: string;
  connecting: string;
  reconnecting: string;
  netErrors: Record<NetError, string>;
}
