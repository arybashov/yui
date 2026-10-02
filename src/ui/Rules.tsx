import { useT } from '../i18n';

export function Rules({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel rules" role="dialog" aria-label={t.rules} onClick={(e) => e.stopPropagation()}>
        <h2>{t.rules}</h2>
        <ul>
          {t.rulesItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <button type="button" className="btn primary" onClick={onClose}>
          {t.gotIt}
        </button>
      </div>
    </div>
  );
}
