// Бот @yui_cards_bot на Cloudflare Workers: оплата «Поддержать» звёздами и ответы в чате.
// Игровой сервер стоит в российском дата-центре, откуда Telegram API недоступен, поэтому всё,
// что требует Telegram API, живёт здесь, а сервер обращается сюда по HTTPS (server/telegram.ts).
//
// Секреты (npx wrangler secret put ...): BOT_TOKEN — токен бота, WEBHOOK_SECRET — подпись вебхука
// Telegram, API_SECRET — пароль игрового сервера (тот же, что BOT_RELAY_SECRET в /opt/yui/yui.env).
// Поддержавшие хранятся в KV SUPPORTERS: ключ user:<telegram id>.

/** Суммы в звёздах — те же, что кнопки в игре (src/ui/Support.tsx). */
const AMOUNTS = [50, 150, 500];

const TEXTS = {
  ru: {
    invoiceTitle: 'Поддержать YUI',
    invoiceDescription: 'Спасибо, что поддерживаете игру! У вашего имени за столом появится ⭐.',
    invoiceLabel: 'Поддержка YUI',
    thanks: 'Спасибо за поддержку! ⭐ у вашего имени теперь видят все за столом.',
    start: 'YUI — быстрая карточная игра на 2–5 игроков. Играйте с ботами или зовите друзей.',
    play: 'Играть',
    paysupport: (email) => `Вопросы об оплате и возврате звёзд — на почту ${email}. Укажите, когда платили и сколько звёзд.`,
    badAmount: 'Такой суммы нет. Откройте игру и выберите сумму там.',
  },
  en: {
    invoiceTitle: 'Support YUI',
    invoiceDescription: 'Thank you for supporting the game! A ⭐ will appear next to your name at the table.',
    invoiceLabel: 'YUI support',
    thanks: 'Thank you for your support! Everyone at the table now sees the ⭐ next to your name.',
    start: 'YUI is a fast card game for 2–5 players. Play against bots or invite friends.',
    play: 'Play',
    paysupport: (email) => `For payment and refund questions, email ${email}. Say when you paid and how many stars.`,
    badAmount: 'There is no such amount. Open the game and choose one there.',
  },
};

const textsFor = (lang) => (lang === 'ru' ? TEXTS.ru : TEXTS.en);
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

async function telegram(env, method, body) {
  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}

/** Счёт выставлен на payload support:<id>:<сумма>; подтверждаем только свои суммы в звёздах. */
function parsePayload(payload) {
  const match = /^support:(\d+):(\d+)$/.exec(payload ?? '');
  return match ? { userId: Number(match[1]), amount: Number(match[2]) } : null;
}

async function handleUpdate(update, env) {
  const query = update.pre_checkout_query;
  if (query) {
    const order = parsePayload(query.invoice_payload);
    const ok = Boolean(order && AMOUNTS.includes(order.amount) && query.currency === 'XTR' && query.total_amount === order.amount);
    await telegram(env, 'answerPreCheckoutQuery', {
      pre_checkout_query_id: query.id,
      ok,
      ...(ok ? {} : { error_message: textsFor(query.from?.language_code).badAmount }),
    });
    return;
  }

  const message = update.message;
  if (!message?.from) return;
  const t = textsFor(message.from.language_code);
  const reply = (text, extra = {}) => telegram(env, 'sendMessage', { chat_id: message.chat.id, text, ...extra });

  const payment = message.successful_payment;
  if (payment) {
    // поддержавший — тот, кто заплатил (ссылку на счёт могли переслать)
    const key = `user:${message.from.id}`;
    const record = (await env.SUPPORTERS.get(key, 'json')) ?? { total: 0, payments: [] };
    record.total += payment.total_amount;
    record.payments.push({ charge: payment.telegram_payment_charge_id, amount: payment.total_amount, at: Date.now() });
    await env.SUPPORTERS.put(key, JSON.stringify(record));
    await reply(t.thanks);
    return;
  }

  const command = (message.text ?? '').split(/[\s@]/)[0];
  if (command === '/paysupport') return void (await reply(t.paysupport(env.SUPPORT_EMAIL)));
  if (command === '/start') {
    await reply(t.start, { reply_markup: { inline_keyboard: [[{ text: t.play, web_app: { url: env.GAME_URL } }]] } });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // вебхук Telegram: подлинность — по секрету, который бот передал при setWebhook
    if (url.pathname === '/telegram' && request.method === 'POST') {
      if (request.headers.get('x-telegram-bot-api-secret-token') !== env.WEBHOOK_SECRET) {
        return new Response('forbidden', { status: 403 });
      }
      await handleUpdate(await request.json(), env);
      return json({ ok: true });
    }

    // дальше — только для игрового сервера
    if (!env.API_SECRET || request.headers.get('authorization') !== `Bearer ${env.API_SECRET}`) {
      return json({ error: 'forbidden' }, 403);
    }

    if (url.pathname === '/supporter' && request.method === 'GET') {
      const id = Number(url.searchParams.get('id'));
      if (!Number.isSafeInteger(id) || id <= 0) return json({ error: 'bad id' }, 400);
      return json({ supporter: (await env.SUPPORTERS.get(`user:${id}`)) !== null });
    }

    if (url.pathname === '/invoice' && request.method === 'POST') {
      const { userId, amount, lang } = await request.json();
      if (!Number.isSafeInteger(userId) || !AMOUNTS.includes(amount)) return json({ error: 'bad request' }, 400);
      const t = textsFor(lang);
      const result = await telegram(env, 'createInvoiceLink', {
        title: t.invoiceTitle,
        description: t.invoiceDescription,
        payload: `support:${userId}:${amount}`,
        currency: 'XTR',
        prices: [{ label: t.invoiceLabel, amount }],
      });
      return result.ok ? json({ link: result.result }) : json({ error: result.description }, 502);
    }

    // один раз после выкладки: направить Telegram на этот бот и показать команды в меню чата
    if (url.pathname === '/setup' && request.method === 'POST') {
      const webhook = await telegram(env, 'setWebhook', {
        url: `${url.origin}/telegram`,
        secret_token: env.WEBHOOK_SECRET,
        allowed_updates: ['message', 'pre_checkout_query'],
      });
      const commands = await Promise.all([
        telegram(env, 'setMyCommands', { commands: [{ command: 'start', description: 'Играть в YUI' }, { command: 'paysupport', description: 'Вопросы об оплате' }], language_code: 'ru' }),
        telegram(env, 'setMyCommands', { commands: [{ command: 'start', description: 'Play YUI' }, { command: 'paysupport', description: 'Payment questions' }] }),
      ]);
      return json({ webhook, commands });
    }

    return json({ error: 'not found' }, 404);
  },
};
