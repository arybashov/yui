import { RefObject, useLayoutEffect, useRef } from 'react';
import { LogEntry } from '../game/engine';
import { PlayerView } from '../game/session';
import { cardImage } from './CardView';

// Анимация карт по приёму FLIP: после каждой перерисовки сравниваем, где карта
// была и где оказалась, и проигрываем движение между этими положениями.
// Карты, которых на экране не было (ход соперника), вылетают от его места;
// карты, которые с экрана пропали (соперник взял), улетают к нему «призраком».

const FLY_MS = 360;
const DEAL_STEP_MS = 45;
const GROUP_STEP_MS = 70;
const EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

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

/** Карта, которой уже нет в разметке, долетает до цели отдельной картинкой и исчезает. */
function ghost(cardId: string, from: DOMRect, to: DOMRect, delay: number): void {
  const img = document.createElement('img');
  img.src = cardImage(cardId);
  img.alt = '';
  img.style.cssText =
    `position:fixed;left:${from.left}px;top:${from.top}px;width:${from.width}px;height:${from.height}px;` +
    'z-index:6;pointer-events:none;transform-origin:top left;filter:drop-shadow(0 2px 3px rgba(0,0,0,.55))';
  document.body.appendChild(img);
  const end = `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})`;
  const animation = img.animate(
    [
      { transform: 'none', opacity: 1 },
      { transform: end, opacity: 1, offset: 0.85 },
      { transform: end, opacity: 0 },
    ],
    { duration: FLY_MS, easing: EASING, delay, fill: 'both' },
  );
  animation.onfinish = () => img.remove();
  animation.oncancel = () => img.remove();
}

/** Место, откуда вылетают и куда прилетают карты соперника. */
function seatRect(root: HTMLElement, seat: number): DOMRect | null {
  const stack = root.querySelector<HTMLElement>(`[data-seat="${seat}"] .opp-cards`);
  if (!stack) return null;
  const card = stack.querySelector<HTMLElement>('.card:last-child');
  if (card) return card.getBoundingClientRect();
  // у соперника не осталось карт — берём середину его области
  const box = stack.getBoundingClientRect();
  const height = box.height;
  const width = height / 1.785;
  return new DOMRect(box.left + (box.width - width) / 2, box.top, width, height);
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
      if (entry && source) fly(el, source, rect, order(entry, id));
      else el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250 });
    });

    old.forEach((from, id) => {
      if (now.has(id)) return;
      const entry = entryOf(id);
      if (!entry) return;
      // соперник забрал карту или карта ушла под стопку
      const hidden = root.querySelector<HTMLElement>('.pile .stack')?.getBoundingClientRect() ?? center;
      const target = entry.type === 'take' ? seatRect(root, entry.player) : hidden;
      if (target) ghost(id, from, target, order(entry, id));
    });
  }, [rootRef, view, tutorial]);
}
