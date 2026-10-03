import { useEffect, useRef, useState } from 'react';
import { GAME_TITLE } from '../config';
import { Card, legalMoves, takeCount } from '../game/engine';
import { PlayerInfo, PlayerView, Session } from '../game/session';
import { useT } from '../i18n';
import { markGameplay, showInterstitial } from '../platform/yandex';
import { useCardAnimations } from './animations';
import { CardBack, CardView } from './CardView';
import { playSound } from './sound';
import { Settings } from './Settings';
import { vibrate } from './haptics';
import { describeAction, playerName, rankLabel } from './text';

interface TableProps {
  session: Session;
  onExit: () => void;
  /** сообщение поверх стола, например об обрыве связи */
  notice?: string;
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

export function Table({ session, onExit, notice, coach }: TableProps) {
  const t = useT();
  const [view, setView] = useState<PlayerView | null>(null);
  /** меню паузы и экран настроек — как в «Городках» */
  const [menu, setMenu] = useState<'closed' | 'pause' | 'settings'>('closed');

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

  // Между раздачами — логическая пауза: здесь площадка может показать рекламу.
  const newDeal = async () => {
    await showInterstitial();
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
        <button type="button" className="btn small pause-btn" onClick={() => setMenu('pause')}>
          <span aria-hidden="true">❚❚ </span>
          {t.pause}
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
            <button type="button" className="btn primary" onClick={onExit}>
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
            <button type="button" className="btn wide" onClick={() => setMenu('settings')}>
              {t.settings}
            </button>
            <button type="button" className="btn wide" onClick={onExit}>
              {t.toMenu}
            </button>
          </div>
        </div>
      )}
      {menu === 'settings' && <Settings onClose={() => setMenu('pause')} />}
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
    playSound(entry.type === 'take' ? 'take' : 'card', { count: entry.cards.length, delay: i * 0.3 });
  });

  if (view.phase === 'over') {
    let result: 'win' | 'safe' | 'lose' | 'matchLost' = 'safe';
    if (view.matchLoser === me) result = 'matchLost';
    else if (view.loser === me) result = 'lose';
    else if (view.players[me].place === 1) result = 'win';
    playSound(result, { delay: 0.4 });
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
  let title: string;
  if (view.matchLoser === me) title = t.resultMatchLostYou(GAME_TITLE);
  else if (view.matchLoser !== null) title = t.resultMatchLost(playerName(view.players[view.matchLoser], t), GAME_TITLE);
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
        <table>
          <thead>
            <tr>
              <th>{t.colPlayer}</th>
              <th>{t.colOutcome}</th>
              <th>{t.colLetters}</th>
            </tr>
          </thead>
          <tbody>
            {order.map(({ player, seat }) => (
              <tr key={seat} className={seat === me ? 'you' : ''}>
                <td>{seat === me ? `${player.name} ${t.youSuffix}` : playerName(player, t)}</td>
                <td>{player.place !== null ? t.wentOut(player.place) : t.leftWithCards}</td>
                <td className="letters">{letters(player.losses) || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
      </div>
    </div>
  );
}
