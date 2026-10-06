import { LANGS, Lang, chooseLang, langName, useLang } from '../i18n';

/** Флаги нарисованы картинками: эмодзи-флаги на Windows показываются буквами. */
const FLAGS: Record<Lang, React.ReactNode> = {
  ru: (
    <svg viewBox="0 0 9 6" preserveAspectRatio="none" aria-hidden="true">
      <rect width="9" height="2" fill="#fff" />
      <rect y="2" width="9" height="2" fill="#0039a6" />
      <rect y="4" width="9" height="2" fill="#d52b1e" />
    </svg>
  ),
  en: (
    <svg viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <clipPath id="flag-en-quarters">
        <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
      </clipPath>
      <path d="M0,0 v30 h60 v-30 z" fill="#012169" />
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
      <path d="M0,0 L60,30 M60,0 L0,30" clipPath="url(#flag-en-quarters)" stroke="#c8102e" strokeWidth="4" />
      <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
      <path d="M30,0 v30 M0,15 h60" stroke="#c8102e" strokeWidth="6" />
    </svg>
  ),
};

/** Выбор языка флагами: площадка не допускает в интерфейсе текст на другом языке,
 *  а флаг понятен, даже если текущий язык игроку незнаком. */
export function LanguageSwitch() {
  const lang = useLang();
  return (
    <div className="flags">
      {LANGS.map((code) => (
        <button
          key={code}
          type="button"
          className={`flag ${code === lang ? 'on' : ''}`}
          aria-label={langName(code)}
          aria-pressed={code === lang}
          onClick={() => chooseLang(code)}
        >
          {FLAGS[code]}
        </button>
      ))}
    </div>
  );
}
