import { useEffect, useState } from 'react';
import { Store } from '../store';
import { en } from './en';
import { ru } from './ru';
import { Dict } from './types';

export type Lang = 'ru' | 'en';
export type { Dict, NetError } from './types';

export const LANGS: Lang[] = ['ru', 'en'];
const DICTS: Record<Lang, Dict> = { ru, en };
const STORAGE_KEY = 'yui.lang';
/** Языки, носителям которых русский интерфейс понятнее английского. */
const RUSSIAN_SPEAKING = ['ru', 'be', 'kk', 'uk', 'uz'];

/** Переводит код языка (ISO 639-1, возможно с регионом) в язык интерфейса. */
export function langFromCode(code: string | undefined): Lang {
  const base = (code ?? '').toLowerCase().split(/[-_]/)[0];
  return RUSSIAN_SPEAKING.includes(base) ? 'ru' : 'en';
}

function savedLang(): Lang | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'ru' || saved === 'en' ? saved : null;
  } catch {
    return null;
  }
}

const state = new Store<{ lang: Lang }>({ lang: savedLang() ?? langFromCode(navigator.language) });

function apply(lang: Lang): void {
  state.set({ lang });
  document.documentElement.lang = lang;
}

/** Язык, определённый площадкой (SDK Яндекс Игр). Ручной выбор игрока важнее. */
export function setPlatformLang(code: string): void {
  if (!savedLang()) apply(langFromCode(code));
}

/** Язык, выбранный игроком вручную: запоминается. */
export function chooseLang(lang: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // выбор просто не запомнится
  }
  apply(lang);
}

export const currentLang = (): Lang => state.get().lang;
export const dict = (): Dict => DICTS[state.get().lang];
export const langName = (lang: Lang): string => DICTS[lang].langName;

export function useLang(): Lang {
  const [lang, setLang] = useState(state.get().lang);
  useEffect(() => state.subscribe((next) => setLang(next.lang)), []);
  return lang;
}

/** Тексты интерфейса на текущем языке; компонент перерисуется при его смене. */
export function useT(): Dict {
  return DICTS[useLang()];
}
