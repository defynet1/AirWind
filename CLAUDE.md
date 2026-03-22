# CLAUDE.md

Этот файл содержит инструкции для Claude Code (claude.ai/code) при работе с данным репозиторием.

**Общение**: всегда отвечай на русском языке.

## Команды

```bash
npm install          # Установить зависимости (ws, sql.js)
npm start            # Запустить сервер (node server.js)
PORT=8080 npm start  # Запустить на другом порту (по умолчанию: 3000)
```

После запуска открыть `http://localhost:3000`. Сборка не требуется.

## Архитектура

AirWind — мессенджер реального времени с бэкендом на Node.js и одностраничным HTML-фронтендом.

### Бэкенд (`server.js`)

Один файл, объединяющий:
- **HTTP-сервер** — отдаёт статические файлы из корня проекта (index.html и др.)
- **WebSocket-сервер** (через `ws`) — вся логика приложения через постоянное соединение
- **PostgreSQL** (через `pg`) — подключение через `DATABASE_URL`

**Схема БД**: `users`, `chats`, `chat_members`, `messages`, `read_receipts`. Специальный чат `__global__` — общий зал для всех пользователей.

**Протокол WebSocket**: все сообщения — JSON вида `{ type: string, payload: object }`. Клиент отправляет: `login`, `register`, `send_message`, `edit_message`, `delete_message`, `mark_read`, `typing_start`, `typing_stop`, `create_private_chat`, `create_group_chat`, `update_profile`, `load_more`. Сервер рассылает: `new_message`, `message_edited`, `message_deleted`, `messages_read`, `typing`, `online`, `user_joined`, `user_updated`, `chat_created`, `chat_history`.

**`clients` map** (`ws → { userId, username }`) — активные аутентифицированные соединения. Объект `typing` (`chatId → Set<userId>`) — кто сейчас печатает.

**Хэширование паролей**: SHA-256 со статической солью `airwind_v2`.

**Переменная окружения**: `DATABASE_URL` — строка подключения к PostgreSQL (Railway подставляет автоматически при линковке сервисов).

### Фронтенд (`index.html`)

Один самодостаточный файл с HTML, CSS и JavaScript внутри. Подключается через WebSocket и хранит локальное состояние (текущий пользователь, список чатов, сообщения, онлайн-пользователи). Два представления: `#auth` (вход/регистрация) и `#app` (основной интерфейс: сайдбар + область чата).
