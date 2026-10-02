import { Card, createDeck } from '../game/engine';
import { cardLabel } from './text';

// Картинки карт лежат в public/cards и нарезаются скриптом art/slice.py.
export const cardImage = (name: string) => `${import.meta.env.BASE_URL}cards/${name}.webp`;

const PRELOAD_TIMEOUT_MS = 8000;

/** Загружает всю колоду заранее, чтобы карты не появлялись на столе с задержкой.
 *  Завершается, когда картинки загружены (или не загрузились) либо вышло время. */
export function preloadCards(): Promise<void> {
  const loads = [...createDeck().map((card) => card.id), 'back'].map(
    (name) =>
      new Promise<void>((resolve) => {
        const image = new Image();
        image.onload = () => resolve();
        image.onerror = () => resolve();
        image.src = cardImage(name);
      }),
  );
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, PRELOAD_TIMEOUT_MS));
  return Promise.race([Promise.all(loads).then(() => undefined), timeout]);
}

interface CardViewProps {
  card: Card;
  dimmed?: boolean;
  onClick?: () => void;
}

export function CardView({ card, dimmed, onClick }: CardViewProps) {
  const className = ['card', dimmed ? 'dimmed' : '', onClick ? 'clickable' : '']
    .filter(Boolean)
    .join(' ');
  const face = <img src={cardImage(card.id)} alt="" draggable={false} />;
  if (!onClick) {
    return (
      <div className={className} data-card={card.id} role="img" aria-label={cardLabel(card)}>
        {face}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={className}
      data-card={card.id}
      aria-label={cardLabel(card)}
      onClick={onClick}
    >
      {face}
    </button>
  );
}

export function CardBack() {
  return (
    <div className="card" aria-hidden="true">
      <img src={cardImage('back')} alt="" draggable={false} />
    </div>
  );
}
