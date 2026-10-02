import { useEffect, useState } from 'react';
import { playSound, setSoundEnabled, soundSetting } from './sound';

function useSoundEnabled(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState(soundSetting.get().enabled);

  useEffect(() => soundSetting.subscribe((setting) => setEnabled(setting.enabled)), []);

  const change = (next: boolean) => {
    setSoundEnabled(next);
    // короткий звук подтверждает, что включилось
    playSound('card');
  };
  return [enabled, change];
}

/** Круглая кнопка со значком динамика — для верхней панели стола. */
export function SoundToggle() {
  const [enabled, change] = useSoundEnabled();
  const label = enabled ? 'Выключить звук' : 'Включить звук';
  return (
    <button
      type="button"
      className="btn icon"
      aria-label={label}
      title={label}
      aria-pressed={enabled}
      onClick={() => change(!enabled)}
    >
      <svg
        viewBox="0 0 24 24"
        width="22"
        height="22"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
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

/** Подписанный переключатель «Вкл / Выкл» — для меню. */
export function SoundSwitch() {
  const [enabled, change] = useSoundEnabled();
  return (
    <div className="field">
      <span>Звук</span>
      <div className="segmented">
        <button type="button" className={enabled ? 'on' : ''} aria-pressed={enabled} onClick={() => change(true)}>
          Вкл
        </button>
        <button type="button" className={enabled ? '' : 'on'} aria-pressed={!enabled} onClick={() => change(false)}>
          Выкл
        </button>
      </div>
    </div>
  );
}
