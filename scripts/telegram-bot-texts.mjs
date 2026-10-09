// Имя, описание и короткое описание бота @yui_cards_bot на разных языках.
// В BotFather у этих полей один язык; по-языковые тексты задаются только через Bot API.
// Тексты — promo/telegram/bot-texts.json: "default" видят все, у кого язык Telegram не из списка,
// остальные ключи — коды языков (ru, en, ...).
//
// Токен берётся из переменной окружения и никуда не печатается:
//   PowerShell:  $env:TELEGRAM_BOT_TOKEN = "<токен>"; node scripts/telegram-bot-texts.mjs
//   bash:        TELEGRAM_BOT_TOKEN=<токен> node scripts/telegram-bot-texts.mjs
// Без токена скрипт только проверяет длину текстов.

import { readFileSync } from 'node:fs';

const LIMITS = { name: 64, short_description: 120, description: 512 };
const METHODS = { name: 'setMyName', short_description: 'setMyShortDescription', description: 'setMyDescription' };

const texts = JSON.parse(readFileSync(new URL('../promo/telegram/bot-texts.json', import.meta.url), 'utf8'));

let tooLong = false;
for (const [lang, fields] of Object.entries(texts)) {
  for (const [field, value] of Object.entries(fields)) {
    const length = [...value].length;
    const ok = length <= LIMITS[field];
    if (!ok) tooLong = true;
    console.log(`${ok ? 'ok ' : 'TOO LONG'} ${lang.padEnd(7)} ${field.padEnd(17)} ${length}/${LIMITS[field]}`);
  }
}
if (tooLong) process.exit(1);

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.log('\nTELEGRAM_BOT_TOKEN не задан — тексты только проверены, в Telegram ничего не отправлено.');
  process.exit(0);
}

for (const [lang, fields] of Object.entries(texts)) {
  for (const [field, value] of Object.entries(fields)) {
    const body = { [field]: value };
    if (lang !== 'default') body.language_code = lang;
    const response = await fetch(`https://api.telegram.org/bot${token}/${METHODS[field]}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    console.log(`${result.ok ? 'set' : 'FAILED'} ${lang} ${field}${result.ok ? '' : ` — ${result.description}`}`);
    // у setMyName свой лимит частоты: при 429 Telegram говорит, сколько ждать
    if (result.parameters?.retry_after) console.log(`  повторите через ${result.parameters.retry_after} с`);
  }
}
