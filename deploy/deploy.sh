#!/usr/bin/env bash
# Ставит или обновляет YUI на сервере: клиент — в /var/www/yui, игровой сервер — под PM2,
# сайт yui.com.ru — в nginx с сертификатом Let's Encrypt.
#
# Готовые файлы берутся из релиза `latest` на GitHub (его собирает .github/workflows/release.yml),
# поэтому на сервере не нужны ни Node 22, ни npm: достаточно node 20+, pm2, nginx, certbot, curl, tar.
#
# Первый запуск (под root, e-mail нужен для сертификата):
#   curl -fsSL https://raw.githubusercontent.com/arybashov/yui/main/deploy/deploy.sh | bash -s -- you@example.com
# Обновление — та же команда без e-mail.
set -euo pipefail

DOMAIN="${YUI_DOMAIN:-yui.com.ru}"
RELEASE="https://github.com/arybashov/yui/releases/download/latest"
WEBROOT=/var/www/yui
APP=/opt/yui
# 8787 на этом сервере занят RRaM
PORT=8790
EMAIL="${1:-}"

if [[ "$EUID" -ne 0 ]]; then
  echo "Запускать под root (или через sudo)" >&2
  exit 1
fi

for tool in curl tar nginx pm2 node; do
  command -v "$tool" >/dev/null || { echo "Нет команды $tool" >&2; exit 1; }
done

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "Скачиваем сборку..."
curl -fsSL "$RELEASE/site.tar.gz" -o "$work/site.tar.gz"
curl -fsSL "$RELEASE/server.cjs" -o "$work/server.cjs"

echo "Клиент -> $WEBROOT"
mkdir -p "$work/site" "$WEBROOT"
tar -xzf "$work/site.tar.gz" -C "$work/site"
rm -rf "$WEBROOT.new"
mv "$work/site" "$WEBROOT.new"
chown -R www-data:www-data "$WEBROOT.new"
rm -rf "$WEBROOT.old"
mv "$WEBROOT" "$WEBROOT.old"
mv "$WEBROOT.new" "$WEBROOT"
rm -rf "$WEBROOT.old"

echo "Сервер -> $APP"
mkdir -p "$APP"
install -m 644 "$work/server.cjs" "$APP/server.cjs"
# Логин/пароль админки (общие с RRaM) лежат в root-only файле и переживают обновления.
# Если файла нет — сервер просто отдаёт /admin/data как 503, игра работает как обычно.
export HOST=127.0.0.1 PORT=$PORT
if [[ -f "$APP/yui.env" ]]; then
  set -a
  . "$APP/yui.env"
  set +a
fi
if pm2 describe yui >/dev/null 2>&1; then
  pm2 restart yui --update-env
else
  pm2 start "$APP/server.cjs" --name yui
fi
pm2 save

for attempt in $(seq 1 15); do
  if curl -fsS "http://127.0.0.1:$PORT/health" | grep -q '"ok":true'; then break; fi
  if [[ "$attempt" = 15 ]]; then echo 'Игровой сервер не отвечает' >&2; exit 1; fi
  sleep 1
done

# Конфиг nginx ставим только в первый раз: потом в нём живут правки certbot.
if [[ ! -e /etc/nginx/sites-available/yui.conf ]]; then
  echo "nginx: сайт $DOMAIN"
  curl -fsSL "https://raw.githubusercontent.com/arybashov/yui/main/deploy/nginx-yui.conf" \
    | sed "s/yui\.com\.ru/$DOMAIN/g" > /etc/nginx/sites-available/yui.conf
  ln -sf /etc/nginx/sites-available/yui.conf /etc/nginx/sites-enabled/yui.conf
  nginx -t
  systemctl reload nginx
fi

if [[ ! -e "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]]; then
  if [[ -z "$EMAIL" ]]; then
    echo "Сертификата ещё нет. Запустите: certbot --nginx -d $DOMAIN -m you@example.com --agree-tos --redirect" >&2
  else
    command -v certbot >/dev/null || { echo "Нет команды certbot" >&2; exit 1; }
    certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --no-eff-email --redirect --non-interactive
  fi
fi

echo "Готово: https://$DOMAIN/  (игровой сервер на 127.0.0.1:$PORT, /health)"
