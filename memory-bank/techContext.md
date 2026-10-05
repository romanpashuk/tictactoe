# Tech Context

## Технологии

| Слой | Технология | Версия |
|---|---|---|
| Runtime | Node.js | >= 18 (проверено на 22.20.0) |
| Backend | Express | ^4.21.2 |
| БД | better-sqlite3 (SQLite) | ^11.7.0 |
| Frontend | Vanilla JS + CSS | без зависимостей |

## Зависимости

Всего **2** — обе рантайм:

| Пакет | Зачем |
|---|---|
| `express` | HTTP-сервер, маршруты, раздача статики, парсинг JSON |
| `better-sqlite3` | Синхронный драйвер SQLite (нативный модуль, собирается при установке) |

Фреймворков, сборщиков и CDN нет. `package-lock.json` зафиксирован.

## Как запустить

```bash
npm install
npm start          # http://localhost:3000
```

БД `database.sqlite` создаётся автоматически при первом запуске.

## npm-скрипты

| Скрипт | Команда | Что делает |
|---|---|---|
| `npm start` | `node server.js` | Запуск сервера |
| `npm test` | `node logic-test.js` | 40 тестов игровой логики (вкл. режим «2 игрока») |
| `npm run test:css` | `node css-check.js` | 34 проверки целостности CSS |
| `npm run test:db` | `node db-schema-check.js` | 31 тест схемы БД и миграции v1→v2 |
| `npm run test:db-fail` | `node corrupt-db-check.js` | 6 тестов отказоустойчивости |
| `npm run test:e2e` | `node e2e-game.js` | 35 сквозных тестов (**нужен сервер**) |
| `npm run test:all` | все 5 наборов | **146 проверок** |

## Переменные окружения

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `PORT` | `3000` | Порт HTTP-сервера |
| `DB_PATH` | `./database.sqlite` | Путь к файлу БД (нужно тестам) |
| `BASE_URL` | `http://localhost:3000` | Адрес сервера для `e2e-game.js` |

## Схема БД

Таблица `games` (**схема v2**, мигрирует автоматически со старых БД):

| Поле | Тип | Ограничения |
|---|---|---|
| `id` | INTEGER | `PRIMARY KEY AUTOINCREMENT` |
| `x_name` | TEXT | `NOT NULL`, `CHECK(length(trim(...)) BETWEEN 1 AND 30)` |
| `o_name` | TEXT | `NOT NULL`, `CHECK(length(trim(...)) BETWEEN 1 AND 30)` |
| `mode` | TEXT | `NOT NULL DEFAULT 'ai'`, `CHECK(mode IN ('ai','duo'))` |
| `result` | TEXT | `NOT NULL`, `CHECK(result IN ('win','lose','draw'))` — от лица X |
| `played_at` | DATETIME | `NOT NULL DEFAULT CURRENT_TIMESTAMP` (UTC) |

Миграция v1→v2: пересборка таблицы в `initDb()` (SQLite не меняет CHECK через
`ALTER`); `player_name` → `x_name`, ИИ-партии получают `o_name='Компьютер'`,
`mode='ai'`; id и даты сохраняются. Идемпотентна.

Индекс: `idx_played_at ON games(played_at DESC)`.
Запрос истории: `ORDER BY played_at DESC, id DESC LIMIT 10`.

## API-эндпоинты

| Метод | Путь | Тело | Успех | Ошибки |
|---|---|---|---|---|
| GET | `/api/games` | — | `200` массив ≤10 записей | `500` |
| POST | `/api/games` | `{x_name, o_name, mode?, result}` или legacy `{player_name, result}` | `201` созданная запись | `400`, `500` |
| DELETE | `/api/games` | — | `200 {deleted:N}` | `500` |

Ответы записей содержат `x_name, o_name, mode, result, played_at` + legacy
`player_name` (≡ `x_name`, совместимость с ТЗ). В режиме `ai` без `o_name`
сервер подставляет `Компьютер`. Неизвестный путь `/api/*` → `404`.
Тело ошибки: `{ "error": "текст" }`.

## Тонкости окружения

- `better-sqlite3` — **нативный модуль**: на некоторых системах нужен Python и
  инструменты сборки; при отсутствии prebuilt-бинарника будет компиляция.
- Приложение использует `PRAGMA journal_mode = WAL` — рядом с БД появляются
  файлы `database.sqlite-wal` и `database.sqlite-shm`. Их тоже можно удалять
  при сбросе базы.
- При битом `database.sqlite` приложение **намеренно не стартует** (`process.exit(1)`)
  — чтобы не терять данные молча.