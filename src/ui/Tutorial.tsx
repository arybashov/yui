import { useEffect, useState } from 'react';
import { dict, useT } from '../i18n';
import { CoachState, TutorialSession } from '../tutorial/tutorial';
import { Table } from './Table';

export function Tutorial({ onExit, onPlay }: { onExit: () => void; onPlay: () => void }) {
  const t = useT();
  const [session] = useState(() => new TutorialSession({ you: dict().you, teacher: dict().teacher }));
  const [coach, setCoach] = useState<CoachState>(session.coach.get());

  useEffect(() => session.coach.subscribe(setCoach), [session]);

  if (coach.finished) {
    return (
      <div className="screen">
        <div className="done-mark">✓</div>
        <h1 className="title small">{t.tutorialDone}</h1>
        <p className="muted subtitle">{t.tutorialDoneText}</p>
        <button type="button" className="btn primary wide" onClick={onPlay}>
          {t.playWithBot}
        </button>
        <button type="button" className="btn wide" onClick={onExit}>
          {t.toMenu}
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
        title: t.tutorialTitle(coach.step + 1, coach.total),
        text: t.lessons[coach.step][coach.message],
        onNext: coach.solved ? () => session.next() : undefined,
        nextLabel: last ? t.finish : t.next,
      }}
    />
  );
}
