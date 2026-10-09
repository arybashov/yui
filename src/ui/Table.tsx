import { useEffect, useRef, useState } from 'react';
import { GAME_TITLE } from '../config';
import { Card, legalMoves, takeCount } from '../game/engine';
import { PlayerInfo, PlayerView, Session } from '../game/session';
import { useT } from '../i18n';
import { CAN_SHARE_RESULT, markGameplay, shareResult, showInterstitial } from '../platform';
import { useCardAnimations } from './animations';
import { CardBack, CardView } from './CardView';
import { playSound } from './sound';
import { Rules } from './Rules';
import { SoundToggle } from './SoundToggle';
import { vibrate } from './haptics';
import { currentStreak, recordMatch } from './streak';
import { describeAction, playerName, rankLabel } from './text';

interface TableProps {
  session: Session;
  onExit: () => void;
  /** сообщение поверх стола, например об обрыве связи */
  notice?: string;
  /** у сообщения о потере связи — кнопка «Повторить» */
  onRetry?: () => void;
  /** подсказки обучения: показываются над стопкой вместо журнала ходов */
  coach?: Coach;
}

export interface Coach {
  title: string;
  text: string;
  /** задано, когда шаг пройден и можно идти дальше */
  onNext?: () => void;
  nextLabel: string;
}

const MAX_BACKS = 10;
const PILE_TOP = 3;

export function Table({ session, onExit, notice, onRetry, coach }: TableProps) {
  const t = useT();
  const [view, setView] = useState<PlayerView | null>(null);
  /** меню паузы и экран настроек — как в «Городках» */
  const [menu, setMenu] = useState<'closed' | 'pause' | 'rules'>('closed');

  const previous = useRef<PlayerView | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const tutorial = coach !== undefined;

  useEffect(() => session.subscribe(setView), [session]);

  useEffect(() => {
    if (!view) return;
    playViewSounds(previous.current, view, tutorial);
    previous.current = view;
  }, [view, tutorial]);

  useCardAnimations(tableRef, view, tutorial);

  // Пока открыто меню паузы, боты не ходят — как пауза в «Городках». В сетевой игре
  // партию ведёт сервер, и меню просто закрывает стол, не останавливая соперников.
  const menuOpen = menu !== 'closed';
  useEffect(() => {
    session.pauseFor?.('menu', menuOpen);
  }, [session, menuOpen]);
  useEffect(() => () => session.pauseFor?.('menu', false), [session]);

  // Площадке сообщаем, идёт ли игровой процесс: раздача без открытых поверх неё окон.
  const inPlay = view?.phase === 'playing' && !notice && menu === 'closed';
  useEffect(() => {
    markGameplay(inPlay);
  }, [inPlay]);
  useEffect(() => () => markGameplay(false), []);

  if (!view) {
    return (
      <div className="screen">
        <p className="muted">{t.dealing}</p>
      </div>
    );
  }

  const me = view.seat;
  const players = view.players;
  const playing = view.phase === 'playing';
  const myTurn = playing && view.turn === me;
  const moves = myTurn ? legalMoves(view.hand, view.pile) : [];
  // Одна карта кладётся нажатием на неё; три и четыре одинаковые — отдельной кнопкой.
  const singles = new Set(
    moves.flatMap((m) => (m.type === 'play' && m.cards.length === 1 ? m.cards : [])),
  );
  const groups = moves.flatMap((m) => (m.type === 'play' && m.cards.length > 1 ? [m.cards] : []));
  const canTake = moves.some((m) => m.type === 'take');
  const top = view.pile[view.pile.length - 1];

  const play = (cards: string[]) => session.move({ type: 'play', cards });

  let status: string;
  if (!playing) {
    status = t.statusDealOver;
  } else if (myTurn) {
    status = top ? t.statusYourTurn(rankLabel(top.rank)) : t.statusFirstMove;
  } else if (coach) {
    status = t.statusDone(coach.nextLabel);
  } else if (players[me].place !== null) {
    status = t.statusYouOut(players[me].place!);
  } else {
    status = t.statusTurnOf(playerName(players[view.turn], t));
  }

  const opponents = players.map((_, i) => (me + i) % players.length).slice(1);
  const recent = view.log.slice(-3).reverse();

  // Сдаться: раздача идёт, у меня ещё есть карты, и это не обучение
  const canResign = Boolean(session.resign) && !coach && view.phase === 'playing' && view.hand.length > 0;

  // Между раздачами — логическая пауза: здесь площадка может показать рекламу.
  // Только там, где партию ведёт этот браузер (pauseFor): в сетевой игре остальные
  // ждали бы, пока у одного идёт реклама.
  const newDeal = async () => {
    if (session.pauseFor) await showInterstitial();
    session.newDeal();
  };

  return (
    <div className="table" ref={tableRef}>
      <header className="topbar">
        <span className="brand">{GAME_TITLE}</span>
        <span className="muted">{coach ? coach.title : t.deal(view.dealNo)}</span>
        {players[me].losses > 0 && (
          <span className="letters" title={t.yourLetters}>
            {letters(players[me].losses)}
          </span>
        )}
        <span className="spacer" />
        <SoundToggle />
        <button
          type="button"
          className="btn icon"
          aria-label={t.rules}
          title={t.rules}
          onClick={() => setMenu('rules')}
        >
          ?
        </button>
        <button
          type="button"
          className="btn icon"
          aria-label={t.pause}
          title={t.pause}
          onClick={() => setMenu('pause')}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        </button>
      </header>

      <section className="opponents">
        {opponents.map((seat) => (
          <Opponent
            key={seat}
            seat={seat}
            player={players[seat]}
            active={playing && view.turn === seat}
          />
        ))}
      </section>

      <section className="center">
        {coach && (
          <div className="coach" aria-live="polite">
            <p>{coach.text}</p>
            {coach.onNext && (
              <button type="button" className="btn primary" onClick={coach.onNext}>
                {coach.nextLabel}
              </button>
            )}
          </div>
        )}
        <Pile pile={view.pile} />
        <div className="log" aria-live="polite">
          {recent.map((entry, i) => (
            <div key={view.log.length - i} className={i === 0 ? 'log-last' : 'log-old'}>
              {describeAction(entry, playerName(players[entry.player], t), entry.player === me, t)}
            </div>
          ))}
        </div>
      </section>

      <section className="me">
        <div className={`status ${myTurn ? 'your-turn' : ''}`}>{status}</div>
        <div className="actions">
          {groups.map((cards) => (
            <button key={cards.join()} type="button" className="btn primary" onClick={() => play(cards)}>
              {t.playGroup(cards.length, view.hand.find((c) => c.id === cards[1])!.rank)}
            </button>
          ))}
          <button
            type="button"
            className="btn"
            disabled={!canTake}
            onClick={() => session.move({ type: 'take' })}
          >
            {canTake ? t.take(takeCount(view.pile)) : t.takeCards}
          </button>
        </div>
        <div className="hand" style={{ '--gaps': Math.max(view.hand.length - 1, 1) } as React.CSSProperties}>
          {view.hand.map((card) => (
            <CardView
              key={card.id}
              card={card}
              dimmed={myTurn && !singles.has(card.id)}
              onClick={singles.has(card.id) ? () => play([card.id]) : undefined}
            />
          ))}
          {view.hand.length === 0 && <span className="muted">{t.noCardsLeft}</span>}
        </div>
      </section>

      {!playing && <Result view={view} onNewDeal={newDeal} onExit={onExit} />}
      {notice && (
        <div className="overlay">
          <div className="panel">
            <h2>{notice}</h2>
            {onRetry && (
              <button type="button" className="btn primary" onClick={onRetry}>
                {t.tryAgain}
              </button>
            )}
            <button type="button" className={`btn ${onRetry ? '' : 'primary'}`} onClick={onExit}>
              {t.toMenu}
            </button>
          </div>
        </div>
      )}
      {menu === 'pause' && (
        <div className="overlay" onClick={() => setMenu('closed')}>
          <div className="panel pause-menu" role="dialog" aria-label={t.paused} onClick={(e) => e.stopPropagation()}>
            <h2>{t.paused}</h2>
            <button type="button" className="btn primary wide" onClick={() => setMenu('closed')}>
              {t.resume}
            </button>
            {canResign && (
              <>
                <button
                  type="button"
                  className="btn wide"
                  onClick={() => {
                    session.resign?.();
                    setMenu('closed');
                  }}
                >
                  {t.resign}
                </button>
                <p className="muted hint">{t.resignNote}</p>
              </>
            )}
            <button type="button" className="btn wide" onClick={onExit}>
              {t.toMenu}
            </button>
          </div>
        </div>
      )}
      {menu === 'rules' && <Rules onClose={() => setMenu('closed')} />}
    </div>
  );
}

const TURN_SOUND_DELAY = 0.3;

/** Озвучивает то, что изменилось на столе между двумя видами. */
function playViewSounds(before: PlayerView | null, view: PlayerView, tutorial: boolean): void {
  const me = view.seat;
  const myTurn = view.phase === 'playing' && view.turn === me;

  if (!before || before.dealNo !== view.dealNo || view.moveNo < before.moveNo) {
    // новая раздача; в обучении это просто смена позиции, там тихо
    if (tutorial) return;
    playSound('deal');
    if (myTurn) {
      playSound('turn', { delay: 0.5 });
      vibrate(40);
    }
    return;
  }

  const fresh = view.moveNo - before.moveNo;
  if (fresh === 0) return;
  view.log.slice(-fresh).forEach((entry, i) => {
    if (entry.type === 'resign') return;
    playSound(entry.type === 'take' ? 'take' : 'card', { count: entry.cards.length, delay: i * 0.3 });
  });

  if (view.phase === 'over') {
    let result: 'win' | 'safe' | 'lose' | 'matchLost' = 'safe';
    if (view.matchLoser === me) result = 'matchLost';
    else if (view.loser === me) result = 'lose';
    else if (view.players[me].place === 1) result = 'win';
    playSound(result, { delay: 0.4 });
    if (view.matchLoser !== null && !tutorial) recordMatch((view.matchWinners ?? []).includes(me));
  } else if (myTurn && !tutorial) {
    playSound('turn', { delay: TURN_SOUND_DELAY });
    vibrate(40);
  }
}

/** Буквы названия, набранные за проигранные раздачи: Y, YU, YUI. */
function letters(losses: number): string {
  return GAME_TITLE.slice(0, losses);
}

function Opponent({ seat, player, active }: { seat: number; player: PlayerInfo; active: boolean }) {
  const t = useT();
  const out = player.place !== null;
  return (
    <div className={`opponent ${active ? 'active' : ''} ${out ? 'out' : ''}`} data-seat={seat}>
      <div className="opp-name">
        {playerName(player, t)}
        {player.losses > 0 && <span className="letters">{letters(player.losses)}</span>}
      </div>
      <div className="opp-cards">
        {Array.from({ length: Math.min(player.count, MAX_BACKS) }, (_, i) => (
          <CardBack key={i} />
        ))}
      </div>
      <div className="opp-count">{out ? t.wentOut(player.place!) : t.cardsCount(player.count)}</div>
    </div>
  );
}

function Pile({ pile }: { pile: Card[] }) {
  const t = useT();
  if (pile.length === 0) {
    return (
      <div className="pile">
        <div className="card slot">10♠</div>
      </div>
    );
  }
  // 10 пик лежит отдельно, сверху видны только карты, которые можно взять
  const [base, ...rest] = pile;
  const visible = rest.slice(-PILE_TOP);
  const hidden = rest.length - visible.length;
  return (
    <div className="pile">
      <CardView card={base} />
      {hidden > 0 && (
        <div className="card stack" title={t.hiddenPile}>
          +{hidden}
        </div>
      )}
      <div className="pile-top">
        {visible.map((card) => (
          <CardView key={card.id} card={card} />
        ))}
      </div>
    </div>
  );
}

/** Секунды до события, о котором сервер сказал «через ms»; null — события нет. */
function useCountdown(ms: number | null): number | null {
  const [deadline, setDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => setDeadline(ms === null ? null : Date.now() + ms), [ms]);
  useEffect(() => {
    if (deadline === null) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [deadline]);
  return deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000));
}

function Result({
  view,
  onNewDeal,
  onExit,
}: {
  view: PlayerView;
  onNewDeal: () => void;
  onExit: () => void;
}) {
  const t = useT();
  const me = view.seat;
  const myPlace = view.players[me].place;
  const matchOver = view.matchLoser !== null;
  const autoSeconds = useCountdown(view.nextDealIn);
  const last = view.log.at(-1);
  const resigned = last?.type === 'resign' ? last.player : null;
  const winners = view.matchWinners ?? [];
  let title: string;
  // конец матча: заголовок — победитель, строкой ниже — кто собрал буквы
  let subtitle: string | null = null;
  if (view.matchLoser !== null) {
    subtitle =
      view.matchLoser === me
        ? t.resultMatchLostYou(GAME_TITLE)
        : t.resultMatchLost(playerName(view.players[view.matchLoser], t), GAME_TITLE);
  }
  const winnerNames = winners.map((seat) => (seat === me ? `${view.players[seat].name} ${t.youSuffix}` : playerName(view.players[seat], t)));
  if (view.matchLoser !== null && winners.length > 1) title = t.matchWinnersShared(winnerNames.join(', '));
  else if (view.matchLoser !== null && winners[0] === me) title = t.matchWinnerYou;
  else if (view.matchLoser !== null && winners.length === 1) title = t.matchWinner(winnerNames[0]);
  else if (view.matchLoser !== null) title = subtitle!;
  else if (resigned === me) title = t.logYouResign;
  else if (resigned !== null) title = t.logResign(playerName(view.players[resigned], t));
  else if (view.loser === null) title = t.resultDraw;
  else if (view.loser === me) title = t.resultYouLost;
  else if (myPlace === 1) title = t.resultWin;
  else title = t.resultYouPlace(myPlace ?? 1);

  const order = view.players
    .map((player, seat) => ({ player, seat }))
    .sort((a, b) => (a.player.place ?? 99) - (b.player.place ?? 99));

  return (
    <div className="overlay">
      <div className="panel result">
        <h2>{title}</h2>
        {subtitle && subtitle !== title && <p className="muted">{subtitle}</p>}
        <table>
          <thead>
            <tr>
              <th>{t.colPlayer}</th>
              <th>{t.colOutcome}</th>
              <th>{t.colWins}</th>
              <th>{t.colLetters}</th>
            </tr>
          </thead>
          <tbody>
            {order.map(({ player, seat }) => (
              <tr key={seat} className={seat === me ? 'you' : ''}>
                <td>{seat === me ? `${player.name} ${t.youSuffix}` : playerName(player, t)}</td>
                <td>
                  {player.place !== null ? t.wentOut(player.place) : seat === resigned ? t.resignedOutcome : t.leftWithCards}
                </td>
                <td>{player.wins ?? 0}</td>
                <td className="letters">{letters(player.losses) || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {autoSeconds !== null && (
          <p className="countdown">{matchOver ? t.autoNextMatch(autoSeconds) : t.autoNextDeal(autoSeconds)}</p>
        )}
        <div className="actions">
          {view.canRestart ? (
            <button type="button" className="btn primary" onClick={onNewDeal}>
              {matchOver ? t.newMatch : t.newDeal}
            </button>
          ) : (
            <span className="muted">{matchOver ? t.ownerStartsMatch : t.ownerStartsDeal}</span>
          )}
          <button type="button" className="btn" onClick={onExit}>
            {t.toMenu}
          </button>
        </div>
        {matchOver && CAN_SHARE_RESULT && (
          <button type="button" className="btn wide" onClick={() => shareResult(shareText(view, t))}>
            {t.shareResult}
          </button>
        )}
      </div>
    </div>
  );
}

/** Текст «Поделиться результатом»: победа в матче или выигранные раздачи, буквы и серия побед от двух. */
function shareText(view: PlayerView, t: ReturnType<typeof useT>): string {
  if (view.matchLoser === view.seat) return t.shareLost(GAME_TITLE);
  const me = view.players[view.seat];
  const wins = me.wins ?? 0;
  const mine = letters(me.losses);
  const won = (view.matchWinners ?? []).includes(view.seat);
  const streak = currentStreak();
  return [
    won ? t.shareWon(GAME_TITLE, wins, view.dealNo) : wins > 0 ? t.shareWins(GAME_TITLE, wins) : t.sharePlayed(GAME_TITLE),
    mine ? t.shareLetters(mine) : t.shareClean,
    won && streak >= 2 ? t.shareStreak(streak) : '',
    t.shareChallenge,
  ]
    .filter(Boolean)
    .join(' ');
}
