import { RefObject, useLayoutEffect, useRef } from 'react';
import { LogEntry } from '../game/engine';
import { PlayerView } from '../game/session';
import { cardImage } from './CardView';

// Анимация карт по приёму FLIP: после каждой перерисовки сравниваем, где карта
// была и где оказалась, и проигрываем движение между этими положениями.
// Карты, которых на экране не было (ход соперника), вылетают от его места
// рубашкой и переворачиваются; карты, которые с экрана пропали (соперник взял),
// улетают к нему «призраком».

const FLY_MS = 420;
/** Полёт от соперника дольше: карта стартует маленькой, и быстрый полёт выглядит как появление на месте. */
const OPPONENT_FLY_MS = 640;
/** На какой доле полёта рубашка долетает до стопки и начинает переворачиваться. */
const FLIP_AT = 0.68;
const DEAL_STEP_MS = 45;
const GROUP_STEP_MS = 90;
const EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const GHOST_STYLE =
  'position:fixed;z-index:6;pointer-events:none;filter:drop-shadow(0 2px 3px rgba(0,0,0,.55));';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function fly(el: HTMLElement, from: DOMRect, to: DOMRect, delay: number, fadeIn = false): void {
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  const sx = from.width / to.width;
  const sy = from.height / to.height;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01) return;
  // летящая карта должна быть поверх кнопок и руки
  el.style.zIndex = '5';
  const start = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
  const animation = el.animate(
    [
      { transformOrigin: 'top left', transform: start, opacity: fadeIn ? 0 : 1 },
      { transformOrigin: 'top left', transform: 'none', opacity: 1 },
    ],
    { duration: FLY_MS, easing: EASING, delay, fill: 'backwards' },
  );
  const reset = () => {
    el.style.zIndex = '';
  };
  animation.onfinish = reset;
  animation.oncancel = reset;
}

function ghostImage(name: string, at: DOMRect): HTMLImageElement {
  const img = document.createElement('img');
  img.src = cardImage(name);
  img.alt = '';
  img.style.cssText = `${GHOST_STYLE}left:${at.left}px;top:${at.top}px;width:${at.width}px;height:${at.height}px;`;
  document.body.appendChild(img);
  return img;
}

/** Сдвиг и масштаб, переводящие прямоугольник from в to (точка отсчёта — центр). */
function centerTransform(from: DOMRect, to: DOMRect): { move: string; sx: number; sy: number } {
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  return { move: `translate(${dx}px, ${dy}px)`, sx: to.width / from.width, sy: to.height / from.height };
}

/** Ход соперника: рубашка летит от него к стопке и переворачивается лицом. */
function flyFromOpponent(el: HTMLElement, from: DOMRect, to: DOMRect, delay: number): void {
  const { move, sx, sy } = centerTransform(from, to);
  const turned = (1 + FLIP_AT) / 2;
  const timing = { duration: OPPONENT_FLY_MS, delay };

  const back = ghostImage('back', from);
  const flight = back.animate(
    [
      { transform: 'none', offset: 0, easing: 'cubic-bezier(0.3, 0.1, 0.3, 1)' },
      { transform: `${move} scale(${sx}, ${sy})`, offset: FLIP_AT, easing: 'ease-in' },
      { transform: `${move} scale(0, ${sy})`, offset: turned },
      { transform: `${move} scale(0, ${sy})`, offset: 1 },
    ],
    { ...timing, fill: 'both' },
  );
  flight.onfinish = () => back.remove();
  flight.oncancel = () => back.remove();

  // сама карта стопки невидима, пока летит рубашка, и раскрывается с ребра
  el.style.zIndex = '5';
  const reveal = el.animate(
    [
      { transform: 'scaleX(0)', opacity: 0, offset: 0 },
      { transform: 'scaleX(0)', opacity: 0, offset: turned - 0.001 },
      { transform: 'scaleX(0)', opacity: 1, offset: turned, easing: 'ease-out' },
      { transform: 'none', opacity: 1, offset: 1 },
    ],
    { ...timing, fill: 'backwards' },
  );
  const reset = () => {
    el.style.zIndex = '';
  };
  reveal.onfinish = reset;
  reveal.oncancel = () => {
    reset();
    flight.cancel();
  };
}

/** Карта, которой уже нет в разметке, долетает до цели отдельной картинкой и исчезает. */
function flyAway(cardId: string, from: DOMRect, to: DOMRect, delay: number): void {
  const img = ghostImage(cardId, from);
  const { move, sx, sy } = centerTransform(from, to);
  const end = `${move} scale(${sx}, ${sy})`;
  const animation = img.animate(
    [
      { transform: 'none', opacity: 1 },
      { transform: end, opacity: 1, offset: 0.85 },
      { transform: end, opacity: 0 },
    ],
    { duration: OPPONENT_FLY_MS * 0.8, easing: 'cubic-bezier(0.3, 0.1, 0.3, 1)', delay, fill: 'both' },
  );
  animation.onfinish = () => img.remove();
  animation.oncancel = () => img.remove();
}

/** Место, откуда вылетают и куда прилетают карты соперника: середина его стопки рубашек.
 *  Считаем по контейнеру, а не по самим рубашкам: они могут ещё лететь после раздачи. */
function seatRect(root: HTMLElement, seat: number): DOMRect | null {
  const stack = root.querySelector<HTMLElement>(`[data-seat="${seat}"] .opp-cards`);
  if (!stack) return null;
  const ratio = parseFloat(getComputedStyle(stack).getPropertyValue('--card-ratio')) || 1.785;
  const box = stack.getBoundingClientRect();
  const width = box.height / ratio;
  return new DOMRect(box.left + (box.width - width) / 2, box.top, width, box.height);
}

export function useCardAnimations(
  rootRef: RefObject<HTMLElement | null>,
  view: PlayerView | null,
  tutorial: boolean,
): void {
  const previousView = useRef<PlayerView | null>(null);
  const previousRects = useRef(new Map<string, DOMRect>());

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !view) return;

    const last = previousView.current;
    if (
      !tutorial &&
      last &&
      last.dealNo === view.dealNo &&
      last.moveNo === view.moveNo &&
      last.phase === view.phase
    ) {
      // тот же стол пришёл повторно — идущие анимации не трогаем
      previousView.current = view;
      return;
    }

    const cards = [...root.querySelectorAll<HTMLElement>('[data-card]')];
    // незаконченные движения исказили бы замер положений
    cards.forEach((el) => el.getAnimations().forEach((animation) => animation.cancel()));
    const now = new Map(cards.map((el) => [el.dataset.card!, { el, rect: el.getBoundingClientRect() }]));

    const before = previousView.current;
    const old = previousRects.current;
    previousView.current = view;
    previousRects.current = new Map([...now].map(([id, { rect }]) => [id, rect]));

    if (reducedMotion()) return;

    const center = root.querySelector<HTMLElement>('.pile .card')?.getBoundingClientRect() ?? null;
    const newDeal = !before || before.dealNo !== view.dealNo;
    // в обучении каждая новая позиция просто проявляется, без перелётов
    const newPosition = tutorial && !!before && view.moveNo <= before.moveNo;

    if (newDeal && !tutorial && center) {
      // раздача: карты разлетаются из центра стола
      [...root.querySelectorAll<HTMLElement>('.hand .card, .opp-cards .card')].forEach((el, i) => {
        fly(el, center, el.getBoundingClientRect(), i * DEAL_STEP_MS, true);
      });
      return;
    }
    if (newDeal || newPosition) {
      now.forEach(({ el }) => el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250 }));
      return;
    }

    const fresh: LogEntry[] = view.moveNo > before.moveNo ? view.log.slice(-(view.moveNo - before.moveNo)) : [];
    const entryOf = (cardId: string) =>
      fresh.find((entry) => entry.cards.some((card) => card.id === cardId));
    const order = (entry: LogEntry, cardId: string) =>
      entry.cards.findIndex((card) => card.id === cardId) * GROUP_STEP_MS;

    now.forEach(({ el, rect }, id) => {
      const from = old.get(id);
      if (from) {
        // карта осталась на экране: сдвиг в руке, мой ход или моё взятие
        const entry = entryOf(id);
        fly(el, from, rect, entry ? order(entry, id) : 0);
        return;
      }
      const entry = entryOf(id);
      const source = entry?.type === 'play' ? seatRect(root, entry.player) : null;
      if (entry && source) flyFromOpponent(el, source, rect, order(entry, id));
      else el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250 });
    });

    old.forEach((from, id) => {
      if (now.has(id)) return;
      const entry = entryOf(id);
      if (!entry) return;
      // соперник забрал карту или карта ушла под стопку
      const hidden = root.querySelector<HTMLElement>('.pile .stack')?.getBoundingClientRect() ?? center;
      const target = entry.type === 'take' ? seatRect(root, entry.player) : hidden;
      if (target) flyAway(id, from, target, order(entry, id));
    });
  }, [rootRef, view, tutorial]);
}
