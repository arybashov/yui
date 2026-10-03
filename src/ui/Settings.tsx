import { useEffect, useState } from 'react';
import { chooseLang, useLang, useT } from '../i18n';
import { Store } from '../store';
import { hapticsSetting, hapticsSupported, setHapticsEnabled, vibrate } from './haptics';
import { Rules } from './Rules';
import { playSound, setSoundEnabled, soundSetting } from './sound';

function useSetting(store: Store<{ enabled: boolean }>): boolean {
  const [enabled, setEnabled] = useState(store.get().enabled);
  useEffect(() => store.subscribe((s) => setEnabled(s.enabled)), [store]);
  return enabled;
}

/** Строка настроек: нажимается целиком, состояние — переключатель справа. */
function Toggle({
  label,
  note,
  on,
  onChange,
}: {
  label: string;
  note: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button type="button" className="toggle" role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <span className="toggle-text">
        <span className="toggle-label">{label}</span>
        <span className="toggle-note">{note}</span>
      </span>
      <span className={`switch ${on ? 'on' : ''}`} aria-hidden="true">
        <span className="knob" />
      </span>
    </button>
  );
}

/** Экран настроек — устроен как в «Городках»: звук, вибрация, язык, «Как играть», «Готово». */
export function Settings({ onClose }: { onClose: () => void }) {
  const t = useT();
  const lang = useLang();
  const sound = useSetting(soundSetting);
  const haptics = useSetting(hapticsSetting);
  const [showRules, setShowRules] = useState(false);

  if (showRules) return <Rules onClose={() => setShowRules(false)} />;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel settings" role="dialog" aria-label={t.settings} onClick={(e) => e.stopPropagation()}>
        <h2>{t.settings}</h2>
        <div className="toggles">
          <Toggle
            label={t.soundLabel}
            note={t.soundNote}
            on={sound}
            onChange={(on) => {
              setSoundEnabled(on);
              // короткий звук подтверждает, что включилось
              playSound('card');
            }}
          />
          {hapticsSupported && (
            <Toggle
              label={t.hapticsLabel}
              note={t.hapticsNote}
              on={haptics}
              onChange={(on) => {
                setHapticsEnabled(on);
                vibrate(30);
              }}
            />
          )}
          <Toggle label={t.langLabel} note={t.langNote} on={lang === 'en'} onChange={(on) => chooseLang(on ? 'en' : 'ru')} />
        </div>
        <button type="button" className="btn wide" onClick={() => setShowRules(true)}>
          {t.howToPlay}
        </button>
        <button type="button" className="btn primary wide" onClick={onClose}>
          {t.done}
        </button>
      </div>
    </div>
  );
}
