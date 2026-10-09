// Серия побед в матчах подряд — для «Поделиться результатом».
// Хранится в браузере игрока: на другом устройстве серия начнётся заново.

const KEY = 'yui.streak';

function load(): number {
  try {
    const value = Number(localStorage.getItem(KEY));
    return Number.isInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

let streak = load();

/** Матч окончен: победа продлевает серию, всё остальное её обнуляет. */
export function recordMatch(won: boolean): void {
  streak = won ? streak + 1 : 0;
  try {
    localStorage.setItem(KEY, String(streak));
  } catch {
    // серия просто не запомнится
  }
}

/** Сколько матчей подряд выиграно, включая последний. */
export function currentStreak(): number {
  return streak;
}
