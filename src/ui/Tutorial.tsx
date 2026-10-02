import { useEffect, useState } from 'react';
import { CoachState, TutorialSession } from '../tutorial/tutorial';
import { Table } from './Table';

export function Tutorial({ onExit, onPlay }: { onExit: () => void; onPlay: () => void }) {
  const [session] = useState(() => new TutorialSession());
  const [coach, setCoach] = useState<CoachState>(session.coach.get());

  useEffect(() => session.coach.subscribe(setCoach), [session]);

  if (coach.finished) {
    return (
      <div className="screen">
        <div className="done-mark">✓</div>
        <h1 className="title small">Обучение пройдено</h1>
        <p className="muted subtitle">Теперь вы знаете все правила. Попробуйте партию с простым ботом.</p>
        <button type="button" className="btn primary wide" onClick={onPlay}>
          Играть с ботом
        </button>
        <button type="button" className="btn wide" onClick={onExit}>
          В меню
        </button>
      </div>
    );
  }

  const last = coach.step + 1 === coach.total;
  return (
    <Table
      session={session}
      onExit={onExit}
      coach={{
        title: `Обучение · шаг ${coach.step + 1} из ${coach.total}`,
        text: coach.text,
        onNext: coach.solved ? () => session.next() : undefined,
        nextLabel: last ? 'Завершить' : 'Дальше',
      }}
    />
  );
}
