import { useEffect, useRef, useState } from 'react';
import { GAME_TITLE } from '../config';
import { Card, legalMoves, takeCount } from '../game/engine';
import { PlayerInfo, PlayerView, Session } from '../game/session';
import { CardBack, CardView } from './CardView';
import { Rules } from './Rules';
import { playSound } from './sound';
import { SoundToggle } from './SoundToggle';
import { cardsWord, describeAction, plural, rankGroupName, rankLabel } from './text';

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
  const [view, setView] = useState<PlayerView | null>(null);
  const [showRules, setShowRules] = useState(false);

  const previous = useRef<PlayerView | null>(null);
  const tutorial = coach !== undefined;

  useEffect(() => session.subscribe(setView), [session]);

  useEffect(() => {
    if (!view) return;
    playViewSounds(previous.current, view, tutorial);
    previous.current = view;
  }, [view, tutorial]);

  if (!view) {
    return (
      <div className="screen">
        <p className="muted">Раздаём карты…</p>
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
    status = 'Раздача окончена';
  } else if (myTurn) {
    status = top ? `Ваш ход: карта не ниже «${rankLabel(top.rank)}»` : 'Ваш ход: начните с 10♠';
  } else if (coach) {
    status = `Готово — нажмите «${coach.nextLabel}»`;
  } else if (players[me].place !== null) {
    status = `Вы вышли ${ordinal(players[me].place!)} — ждём конца раздачи`;
  } else {
    status = `Ходит ${players[view.turn].name}`;
  }

  const opponents = players.map((_, i) => (me + i) % players.length).slice(1);
  const recent = view.log.slice(-3).reverse();

  return (
    <div className="table">
      <header className="topbar">
        <span className="brand">{GAME_TITLE}</span>
        <span className="muted">{coach ? coach.title : `Раздача ${view.dealNo}`}</span>
        {players[me].losses > 0 && (
          <span className="letters" title="Ваши буквы за проигранные раздачи">
            {letters(players[me].losses)}
          </span>
        )}
        <span className="spacer" />
        <SoundToggle />
        <button type="button" className="btn ghost" onClick={() => setShowRules(true)}>
          Правила
        </button>
        <button type="button" className="btn ghost" onClick={onExit}>
          Выйти
        </button>
      </header>

      <section className="opponents">
        {opponents.map((seat) => (
          <Opponent key={seat} player={players[seat]} active={playing && view.turn === seat} />
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
              {describeAction(entry, players[entry.player].name, entry.player === me)}
            </div>
          ))}
        </div>
      </section>

      <section className="me">
        <div className={`status ${myTurn ? 'your-turn' : ''}`}>{status}</div>
        <div className="actions">
          {groups.map((cards) => (
            <button key={cards.join()} type="button" className="btn primary" onClick={() => play(cards)}>
              Положить {cards.length} {rankGroupName(view.hand.find((c) => c.id === cards[1])!.rank)}
            </button>
          ))}
          <button
            type="button"
            className="btn"
            disabled={!canTake}
            onClick={() => session.move({ type: 'take' })}
          >
            {canTake ? `Взять ${cardsWord(takeCount(view.pile))}` : 'Взять карты'}
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
          {view.hand.length === 0 && <span className="muted">У вас не осталось карт</span>}
        </div>
      </section>

      {!playing && <Result view={view} onNewDeal={() => session.newDeal()} onExit={onExit} />}
      {notice && (
        <div className="overlay">
          <div className="panel">
            <h2>{notice}</h2>
            <button type="button" className="btn primary" onClick={onExit}>
              В меню
            </button>
          </div>
        </div>
      )}
      {showRules && <Rules onClose={() => setShowRules(false)} />}
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
    if (myTurn) playSound('turn', { delay: 0.5 });
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
  }
}

function ordinal(place: number): string {
  return ['первым', 'вторым', 'третьим', 'четвёртым', 'пятым'][place - 1] ?? `${place}-м`;
}

/** Буквы названия, набранные за проигранные раздачи: Y, YU, YUI. */
function letters(losses: number): string {
  return GAME_TITLE.slice(0, losses);
}

function Opponent({ player, active }: { player: PlayerInfo; active: boolean }) {
  const out = player.place !== null;
  return (
    <div className={`opponent ${active ? 'active' : ''} ${out ? 'out' : ''}`}>
      <div className="opp-name">
        {player.name}
        {player.losses > 0 && <span className="letters">{letters(player.losses)}</span>}
      </div>
      <div className="opp-cards">
        {Array.from({ length: Math.min(player.count, MAX_BACKS) }, (_, i) => (
          <CardBack key={i} />
        ))}
      </div>
      <div className="opp-count">
        {out
          ? `вышел ${ordinal(player.place!)}`
          : `${player.count} ${plural(player.count, 'карта', 'карты', 'карт')}`}
      </div>
    </div>
  );
}

function Pile({ pile }: { pile: Card[] }) {
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
        <div className="card stack" title="Карты под верхними тремя">
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
  const me = view.seat;
  const myPlace = view.players[me].place;
  const matchOver = view.matchLoser !== null;
  let title: string;
  if (view.matchLoser === me) title = `Вы собрали ${GAME_TITLE} — матч проигран`;
  else if (view.matchLoser !== null) title = `${view.players[view.matchLoser].name} собирает ${GAME_TITLE} — матч окончен`;
  else if (view.loser === null) title = 'Ничья — проигравшего нет';
  else if (view.loser === me) title = 'Вы остались с картами';
  else if (myPlace === 1) title = 'Победа!';
  else title = `Вы вышли ${ordinal(myPlace ?? 1)}`;

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
              <th>Игрок</th>
              <th>Итог</th>
              <th>Буквы</th>
            </tr>
          </thead>
          <tbody>
            {order.map(({ player, seat }) => (
              <tr key={seat} className={seat === me ? 'you' : ''}>
                <td>{seat === me ? `${player.name} (вы)` : player.name}</td>
                <td>{player.place !== null ? `вышел ${ordinal(player.place)}` : 'остался с картами'}</td>
                <td className="letters">{letters(player.losses) || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="actions">
          {view.canRestart ? (
            <button type="button" className="btn primary" onClick={onNewDeal}>
              {matchOver ? 'Новый матч' : 'Новая раздача'}
            </button>
          ) : (
            <span className="muted">{matchOver ? 'Новый матч' : 'Новую раздачу'} начнёт хост</span>
          )}
          <button type="button" className="btn" onClick={onExit}>
            В меню
          </button>
        </div>
      </div>
    </div>
  );
}
