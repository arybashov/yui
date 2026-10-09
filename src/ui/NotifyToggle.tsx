import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { notifyStatus, setNotify } from '../net/presence';
import { requestWriteAccess } from '../platform';

// «Сообщать, когда ищут соперника» — только в Telegram: бот напишет, когда кто-то ждёт в быстрой игре.
// Писать бот может только с разрешения игрока, поэтому включение сначала спрашивает Telegram.

export function NotifyToggle() {
  const t = useT();
  const [on, setOn] = useState(notifyStatus.get().on);
  const [denied, setDenied] = useState(false);
  useEffect(() => notifyStatus.subscribe(({ on }) => setOn(on)), []);

  // пока сервер не сказал, подписан ли игрок (нет связи с ботом), выключатель не показываем
  if (on === null) return null;

  const turnOn = async () => {
    setDenied(false);
    if (!(await requestWriteAccess())) return setDenied(true);
    setNotify(true);
  };

  return (
    <>
      <div className="field">
        <span>{t.notifyLabel}</span>
        <div className="segmented">
          <button type="button" className={on ? 'on' : ''} aria-pressed={on} onClick={() => !on && turnOn()}>
            {t.notifyOn}
          </button>
          <button type="button" className={on ? '' : 'on'} aria-pressed={!on} onClick={() => on && setNotify(false)}>
            {t.notifyOff}
          </button>
        </div>
      </div>
      <p className={denied ? 'error hint' : 'muted hint'}>{denied ? t.notifyDenied : t.notifyHint}</p>
    </>
  );
}
