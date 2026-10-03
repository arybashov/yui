import { Store } from '../store';

// Вибрация на телефоне — как в «Городках»: короткий отклик, его можно выключить.
// Настольный Chrome тоже объявляет navigator.vibrate, но ничего не делает, поэтому
// переключатель показываем только на сенсорных устройствах — иначе это бесполезная кнопка.

const STORAGE_KEY = 'yui.haptics';

export const hapticsSupported =
  typeof navigator !== 'undefined' &&
  typeof navigator.vibrate === 'function' &&
  typeof matchMedia === 'function' &&
  matchMedia('(pointer: coarse)').matches;

function loadEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export const hapticsSetting = new Store<{ enabled: boolean }>({ enabled: loadEnabled() });

export function setHapticsEnabled(enabled: boolean): void {
  hapticsSetting.set({ enabled });
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // настройка просто не запомнится
  }
}

export function vibrate(pattern: number | number[]): void {
  if (!hapticsSupported || !hapticsSetting.get().enabled || document.hidden) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // вибрация — украшение
  }
}
