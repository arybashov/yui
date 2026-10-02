import { useEffect, useState } from 'react';
import { playSound, setSoundEnabled, soundSetting } from './sound';

export function SoundToggle() {
  const [enabled, setEnabled] = useState(soundSetting.get().enabled);

  useEffect(() => soundSetting.subscribe((setting) => setEnabled(setting.enabled)), []);

  const label = enabled ? 'Выключить звук' : 'Включить звук';
  return (
    <button
      type="button"
      className="btn ghost icon"
      aria-label={label}
      title={label}
      aria-pressed={enabled}
      onClick={() => {
        setSoundEnabled(!enabled);
        // короткий звук подтверждает, что включилось
        playSound('card');
      }}
    >
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none" />
        {enabled ? (
          <>
            <path d="M16.5 8.5a5 5 0 0 1 0 7" />
            <path d="M19 6a8.5 8.5 0 0 1 0 12" />
          </>
        ) : (
          <>
            <path d="M17 9.5l5 5" />
            <path d="M22 9.5l-5 5" />
          </>
        )}
      </svg>
    </button>
  );
}
