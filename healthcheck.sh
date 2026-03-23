#!/bin/bash
# Проверка работоспособности AirWind

PORT=${PORT:-3000}

echo "▶ Запускаем сервер..."
node server.js &
SERVER_PID=$!

sleep 4

echo "▶ Проверяем HTTP..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$PORT/)
if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ HTTP OK (200)"
else
  echo "❌ HTTP FAIL (код: $HTTP_CODE)"
  kill $SERVER_PID 2>/dev/null
  exit 1
fi

echo "▶ Проверяем WebSocket..."
WS_RESULT=$(node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:$PORT');
const t = setTimeout(() => { console.log('TIMEOUT'); ws.terminate(); process.exit(1); }, 3000);
ws.on('open', () => { clearTimeout(t); console.log('OK'); ws.close(); process.exit(0); });
ws.on('error', e => { clearTimeout(t); console.log('ERROR: ' + e.message); process.exit(1); });
" 2>&1)

if [ "$WS_RESULT" = "OK" ]; then
  echo "✅ WebSocket OK"
else
  echo "❌ WebSocket FAIL ($WS_RESULT)"
  kill $SERVER_PID 2>/dev/null
  exit 1
fi

kill $SERVER_PID 2>/dev/null
echo ""
echo "✅ Всё работает!"
