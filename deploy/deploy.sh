#!/usr/bin/env bash
# Выкладка YUI на сервер: клиент — в /var/www/yui, игровой сервер — под PM2.
# Запускать на сервере из клона репозитория: bash deploy/deploy.sh
# Нужны Node.js 22+, npm, pm2, nginx, rsync.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DOMAIN="${YUI_DOMAIN:-yui.com.ru}"
WEBROOT=/var/www/yui
# 8787 на этом сервере занят RRaM
PORT=8790

if [[ "$EUID" -eq 0 ]]; then SUDO=(); else SUDO=(sudo); fi

cd "$REPO"
git pull --ff-only
npm ci
VITE_SERVER_URL="wss://$DOMAIN/ws" npm run build
npm run build:server

"${SUDO[@]}" mkdir -p "$WEBROOT"
"${SUDO[@]}" rsync -a --delete dist/ "$WEBROOT/"

if pm2 describe yui >/dev/null 2>&1; then
  HOST=127.0.0.1 PORT=$PORT pm2 restart yui --update-env
else
  HOST=127.0.0.1 PORT=$PORT pm2 start dist-server/server.cjs --name yui
fi
pm2 save

for attempt in $(seq 1 15); do
  if curl -fsS "http://127.0.0.1:$PORT/health" | grep -q '"ok":true'; then break; fi
  if [[ "$attempt" = 15 ]]; then echo 'Game server did not become healthy' >&2; exit 1; fi
  sleep 1
done

# Конфиг nginx ставим только в первый раз: потом в нём живут правки certbot.
if [[ ! -e /etc/nginx/sites-available/yui.conf ]]; then
  "${SUDO[@]}" cp deploy/nginx-yui.conf /etc/nginx/sites-available/yui.conf
  "${SUDO[@]}" ln -sf /etc/nginx/sites-available/yui.conf /etc/nginx/sites-enabled/yui.conf
  "${SUDO[@]}" nginx -t
  "${SUDO[@]}" systemctl reload nginx
  echo "nginx site installed. Next: sudo certbot --nginx -d $DOMAIN"
fi

echo "Deployed: http://$DOMAIN/ (game server on 127.0.0.1:$PORT)"
