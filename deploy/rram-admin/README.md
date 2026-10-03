# YUI в админке RRaM

Одна админка на две игры: в шапке `rram.com.ru/admin` переключатель **RRaM / YUI**.
Дашборд один и тот же, данные каждой игры приходят со своего сервера:

| Игра | Статистика | Диагностика |
|---|---|---|
| RRaM | `/admin/stats` | `/admin/data` |
| YUI | `/admin/yui-stats` → `127.0.0.1:8790/admin/stats` | `/admin/yui-data` → `127.0.0.1:8790/admin/data` |

Сервер YUI отдаёт данные в том же формате, что RRaM (`server/stats.ts` — порт `admin-stats.js`),
под тем же логином/паролем админки (`ADMIN_USER`/`ADMIN_PASSWORD` в `/opt/yui/yui.env`).

## Что лежит здесь

- `dashboard.js` — `server-prototype/src/admin-assets/dashboard.js` RRaM с переключателем игр.
- `yui-admin.conf` — шаблон nginx-локаций для `/admin/yui-*` (без пароля).

## Текущее состояние

Пока игра RRaM на ревью, изменения внесены **только на живой сервер**, без пуша RRaM:
`dashboard.js` подменён на месте (админка читает ассеты при каждом запросе — рестарт не нужен),
nginx-сниппет подключён в `/etc/nginx/sites-available/rram.conf`. Оригиналы — рядом с суффиксом `.bak-yui`.

Следующий деплой RRaM перезапишет оба файла из своего репозитория, и переключатель пропадёт.

## Чтобы закрепить после ревью

В репозитории RRaM:

1. Заменить `server-prototype/src/admin-assets/dashboard.js` на `dashboard.js` отсюда.
2. В `server-prototype/deploy/nginx-rram.conf` внутри `server { listen 443 … }` перед `location ^~ /admin`
   добавить `include /etc/nginx/snippets/yui-admin.conf;`.
3. Задеплоить RRaM. Сниппет с паролем уже лежит на сервере и деплоем RRaM не трогается.
