// Скриншоты и видео для каталога Яндекс Игр — по образцу «Городков»:
// promo/yandex/upload/{screen|mobile}_{ru|en}_{N}_{сцена}.png и video_{ru|en}_{landscape|portrait}.mp4.
//
// Нужен запущенный dev-сервер (npm run dev): скриншоты снимаются с постановочных
// сцен (?shot=…, см. src/dev/shots.tsx), видео — с настоящей партии против ботов.
//
// Запуск:  node scripts/store-shots.mjs            — всё
//          node scripts/store-shots.mjs shots      — только скриншоты
//          node scripts/store-shots.mjs video      — только видео

import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.YUI_URL ?? 'http://127.0.0.1:5173/';
const OUT = 'promo/yandex/upload';
const TMP = 'promo/yandex/.video-tmp';
const LANGS = ['ru', 'en'];
const SCENES = ['start', 'play', 'four', 'take', 'tutorial', 'online', 'result'];

// Десктоп 1920×1080 и телефон 1080×1920, как в «Городках». Вёрстка — в CSS-пикселях
// размера реальных экранов, а плотность пикселей добирает разрешение.
const DEVICES = {
  screen: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 },
  mobile: { viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};

const VIDEO = {
  landscape: { viewport: { width: 1280, height: 720 }, out: { w: 1920, h: 1080 } },
  portrait: { viewport: { width: 540, height: 960 }, out: { w: 1080, h: 1920 } },
};
const VIDEO_SECONDS = 26; // Яндекс принимает до 28 секунд

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitImages(page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((img) =>
        img.complete ? null : new Promise((r) => img.addEventListener('load', r, { once: true })),
      ),
    );
  });
}

async function shots(browser) {
  mkdirSync(OUT, { recursive: true });
  for (const [kind, device] of Object.entries(DEVICES)) {
    // без анимаций: кадр должен быть ровно той позицией, что поставлена в сцене
    const context = await browser.newContext({ ...device, reducedMotion: 'reduce' });
    const page = await context.newPage();
    for (const lang of LANGS) {
      for (const [i, scene] of SCENES.entries()) {
        await page.goto(`${BASE}?shot=${scene}&lang=${lang}`);
        await page.waitForSelector('.table');
        await waitImages(page);
        await sleep(300);
        const file = join(OUT, `${kind}_${lang}_${i + 1}_${scene}.png`);
        await page.screenshot({ path: file });
        console.log('  ', file);
      }
    }
    await context.close();
  }
}

/** Настоящая партия против трёх ботов: ходим сами, как человек, с паузами. */
async function playRealGame(page, lang, seconds) {
  await page.goto(`${BASE}?lang=${lang}`);
  await waitImages(page);
  await page.locator('.segmented button', { hasText: /^3$/ }).first().click();
  await sleep(400);
  const started = Date.now();
  await page.locator('.btn.primary').first().click();
  const deadline = started + seconds * 1000 + 1500;
  while (Date.now() < deadline) {
    const myTurn = await page.locator('.status.your-turn').count();
    if (myTurn) {
      await sleep(650); // «подумать» — чтобы зритель успел увидеть ход
      const group = page.locator('.me .actions .btn.primary');
      const card = page.locator('.hand button.card');
      const take = page.locator('.me .actions .btn:not(.primary)');
      if ((await group.count()) && Math.random() < 0.7) await group.first().click();
      else if (await card.count()) await card.first().click();
      else if (await take.count()) await take.first().click();
      await sleep(300);
    }
    // раздача кончилась — сразу новая, видео не должно стоять на итогах
    const next = page.locator('.result .btn.primary');
    if (await next.count()) {
      await sleep(1600);
      await next.click().catch(() => undefined);
    }
    await sleep(120);
  }
  return started;
}

async function videos(browser) {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  for (const lang of LANGS) {
    for (const [shape, cfg] of Object.entries(VIDEO)) {
      const dir = join(TMP, `${lang}-${shape}`);
      const context = await browser.newContext({
        viewport: cfg.viewport,
        recordVideo: { dir, size: cfg.viewport },
        isMobile: shape === 'portrait',
        hasTouch: shape === 'portrait',
      });
      const page = await context.newPage();
      const opened = Date.now();
      const started = await playRealGame(page, lang, VIDEO_SECONDS);
      await context.close();
      const webm = join(dir, readdirSync(dir).find((f) => f.endsWith('.webm')));
      // отрезаем загрузку и меню — видео начинается с раздачи
      const skip = Math.max(0, (started - opened) / 1000 + 0.3).toFixed(2);
      const out = join(OUT, `video_${lang}_${shape}.mp4`);
      execFileSync('ffmpeg', [
        '-v', 'error', '-y', '-ss', skip, '-i', webm, '-t', String(VIDEO_SECONDS),
        '-vf', `fps=30,scale=${cfg.out.w}:${cfg.out.h}:flags=lanczos,setsar=1`,
        '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart', out,
      ]);
      console.log('  ', out);
    }
  }
  rmSync(TMP, { recursive: true, force: true });
}

const what = process.argv[2] ?? 'all';
const browser = await chromium.launch();
try {
  if (what === 'all' || what === 'shots') {
    console.log('Скриншоты:');
    await shots(browser);
  }
  if (what === 'all' || what === 'video') {
    console.log('Видео:');
    await videos(browser);
  }
} finally {
  await browser.close();
}
