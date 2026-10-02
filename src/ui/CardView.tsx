import { Card, createDeck } from '../game/engine';
import { cardLabel } from './text';

// Картинки карт лежат в public/cards и нарезаются скриптом art/slice.py.
const cardImage = (name: string) => `${import.meta.env.BASE_URL}cards/${name}.webp`;

/** Загружает всю колоду заранее, чтобы карты не появлялись на столе с задержкой. */
export function preloadCards(): void {
  for (const name of [...createDeck().map((card) => card.id), 'back']) {
    new Image().src = cardImage(name);
  }
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
      <div className={className} role="img" aria-label={cardLabel(card)}>
        {face}
      </div>
    );
  }
  return (
    <button type="button" className={className} aria-label={cardLabel(card)} onClick={onClick}>
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
