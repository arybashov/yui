// Всё на экране — шрифты, отступы, кнопки и карты — меряется в rem и в --cw,
// а они умножаются на --fit. Здесь --fit подбирается так, чтобы текущий экран
// (меню, комната или стол) целиком влезал по высоте: на низком экране
// (ноутбук с масштабом 150 %, окно площадки) всё ужимается вместе, а не наезжает
// друг на друга и не обрезается снизу.

const MIN_FIT = 0.55;
/** запас, чтобы не упираться в край из-за округлений */
const SLACK_PX = 2;

function isFlow(el: Element): boolean {
  const position = getComputedStyle(el).position;
  return position !== 'fixed' && position !== 'absolute';
}

/**
 * Сколько по высоте нужно содержимому колонки (flex или grid сверху вниз),
 * если ему ничего не мешает. Растягиваемая середина стола (.center) сама по
 * себе занимает «сколько дали», поэтому её меряем по её собственному содержимому.
 */
function naturalHeight(el: HTMLElement): number {
  const style = getComputedStyle(el);
  const kids = [...el.children].filter(isFlow) as HTMLElement[];
  const gap = parseFloat(style.rowGap) || 0;
  const inner = kids.reduce(
    (sum, kid) => sum + (kid.classList.contains('center') ? naturalHeight(kid) : kid.offsetHeight),
    0,
  );
  return (
    inner +
    gap * Math.max(kids.length - 1, 0) +
    (parseFloat(style.paddingTop) || 0) +
    (parseFloat(style.paddingBottom) || 0)
  );
}

function setFit(fit: number): void {
  document.documentElement.style.setProperty('--fit', fit.toFixed(3));
}

/** Подогнать масштаб под экран, который сейчас открыт в root. */
function refit(root: HTMLElement): void {
  const screen = root.firstElementChild as HTMLElement | null;
  if (!screen || !(screen.classList.contains('screen') || screen.classList.contains('table'))) {
    setFit(1);
    return;
  }
  const available = root.clientHeight - SLACK_PX;
  // почти всё на экране пропорционально --fit, поэтому хватает пары шагов
  let fit = 1;
  setFit(fit);
  for (let step = 0; step < 4; step++) {
    const need = naturalHeight(screen);
    if (need <= available) break;
    fit = Math.max(MIN_FIT, (fit * available) / need);
    setFit(fit);
    if (fit === MIN_FIT) break;
  }
}

/** Следить за размером окна и за сменой экранов, держа масштаб подогнанным. */
export function startAutoFit(root: HTMLElement): void {
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      refit(root);
    });
  };
  window.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  // экран сменился или на нём поменялся текст/кнопки — пересчитать
  new MutationObserver(schedule).observe(root, { childList: true, subtree: true, characterData: true });
  schedule();
}
