import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { recheckSupporter, requestInvoice, supporterStatus } from '../net/presence';
import { openInvoice } from '../platform';

// «Поддержать» звёздами Telegram — только в сборке для Telegram. Поддержавший получает ⭐ у имени за столом.

/** Суммы в звёздах; сервер выставляет счёт только на них (server/telegram.ts). */
const AMOUNTS = [50, 150, 500];
/** Бот узнаёт об оплате чуть позже, чем игра, а хранилище Cloudflare до минуты расходится между городами: проверяем несколько раз. */
const RECHECK_AFTER_MS = [1500, 5000, 15000, 40000, 70000];

export function Support() {
  const t = useT();
  const [supporter, setSupporter] = useState(supporterStatus.get().supporter);
  const [busy, setBusy] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => supporterStatus.subscribe(({ supporter }) => setSupporter(supporter)), []);

  const support = async (amount: number) => {
    setBusy(amount);
    setFailed(false);
    const link = await requestInvoice(amount);
    if (!link) {
      setBusy(null);
      setFailed(true);
      return;
    }
    const status = await openInvoice(link);
    setBusy(null);
    if (status === 'paid') RECHECK_AFTER_MS.forEach((delay) => setTimeout(recheckSupporter, delay));
    else if (status === 'failed') setFailed(true);
  };

  return (
    <div className="panel">
      <h2>{t.supportTitle}</h2>
      <p className="muted hint">{supporter ? t.supportThanks : t.supportText}</p>
      <div className="segmented">
        {AMOUNTS.map((amount) => (
          <button key={amount} type="button" disabled={busy !== null} onClick={() => support(amount)}>
            {busy === amount ? '…' : `${amount} ⭐`}
          </button>
        ))}
      </div>
      {failed && <p className="error hint">{t.supportFailed}</p>}
    </div>
  );
}
