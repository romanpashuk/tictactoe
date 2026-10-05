/**
 * server.js — сервер приложения (API/TRANSPORT-слой).
 *
 * Отвечает за: раздачу статики, HTTP-валидацию, коды ответов, обработку ошибок.
 * НЕ содержит SQL (весь SQL — в db.js) и НЕ содержит игровой логики (она на клиенте).
 */

'use strict';

const path = require('path');
const express = require('express');

const db = require('./db');

// Порт сервера (по умолчанию 3000)
const PORT = process.env.PORT || 3000;

// Ограничения валидации имени игрока
const NAME_MIN_LENGTH = 1;
const NAME_MAX_LENGTH = 30;

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────

// Разбор JSON-тела запроса (с корректной обработкой невалидного JSON)
app.use(express.json({ limit: '16kb' }));

// Раздача статических файлов из public/
app.use(express.static(path.join(__dirname, 'public')));

// ── Валидация ─────────────────────────────────────────────────────────────

/**
 * Проверить и нормализовать тело POST /api/games.
 *
 * Поддерживает два формата:
 *  - новый: `{x_name, o_name, mode?, result}` — оба игрока явно;
 *  - из ТЗ (promt.md): `{player_name, result}` — партия против компьютера
 *    (player_name = игрок X, o_name подставляется «Компьютер»).
 *
 * @param {any} body Тело запроса.
 * @returns {{ok: true, data: {x_name: string, o_name: string, mode: string, result: string}} | {ok: false, error: string}}
 */
function validateGameBody(body) {
  // Тело должно быть объектом
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      error: 'Ожидается JSON-объект с полями x_name, o_name и result'
    };
  }

  const { x_name: rawX, o_name: rawO, player_name: legacyName, mode, result } = body;

  // 1. Режим необязателен (по умолчанию — против компьютера), но строго из списка
  const gameMode = mode === undefined ? 'ai' : mode;
  if (!db.ALLOWED_MODES.includes(gameMode)) {
    return {
      ok: false,
      error: `mode должен быть одним из: ${db.ALLOWED_MODES.join(', ')}`
    };
  }

  // 2. Имя игрока X: новое поле x_name или legacy player_name из ТЗ
  const rawName = rawX !== undefined ? rawX : legacyName;
  if (typeof rawName !== 'string') {
    return { ok: false, error: 'Поле x_name (или player_name) обязательно и должно быть строкой' };
  }
  const xName = rawName.trim();
  if (xName.length < NAME_MIN_LENGTH) {
    return { ok: false, error: 'Имя игрока X не может быть пустым' };
  }
  if (xName.length > NAME_MAX_LENGTH) {
    return {
      ok: false,
      error: `Имя игрока X: от ${NAME_MIN_LENGTH} до ${NAME_MAX_LENGTH} символов`
    };
  }

  // 3. Имя игрока O: обязательно в режиме «2 игрока»;
  //    в режиме с ИИ по умолчанию «Компьютер»
  let oName;
  if (rawO !== undefined) {
    if (typeof rawO !== 'string') {
      return { ok: false, error: 'Поле o_name должно быть строкой' };
    }
    oName = rawO.trim();
    if (oName.length < NAME_MIN_LENGTH) {
      return { ok: false, error: 'Имя игрока O не может быть пустым' };
    }
    if (oName.length > NAME_MAX_LENGTH) {
      return {
        ok: false,
        error: `Имя игрока O: от ${NAME_MIN_LENGTH} до ${NAME_MAX_LENGTH} символов`
      };
    }
  } else if (gameMode === 'duo') {
    return { ok: false, error: 'В режиме duo обязательно поле o_name (имя игрока 2)' };
  } else {
    oName = 'Компьютер';
  }

  // 4. Результат — строго из разрешённого списка
  if (!db.ALLOWED_RESULTS.includes(result)) {
    return {
      ok: false,
      error: `result должен быть одним из: ${db.ALLOWED_RESULTS.join(', ')}`
    };
  }

  return {
    ok: true,
    data: { x_name: xName, o_name: oName, mode: gameMode, result }
  };
}

/**
 * Формат записи для API-ответа: новые поля + player_name из ТЗ (≡ x_name).
 * @param {{id:number, x_name:string, o_name:string, mode:string, result:string, played_at:string}} row Запись из БД.
 */
function toApiGame(row) {
  return { ...row, player_name: row.x_name };
}

// ── Роуты API ─────────────────────────────────────────────────────────────

/**
 * GET /api/games — получить последние игры (для таблицы в меню).
 * Пустая история — это 200 и пустой массив, а не 404.
 */
app.get('/api/games', (req, res) => {
  try {
    const games = db.listGames(db.HISTORY_LIMIT);
    res.status(200).json(games.map(toApiGame));
  } catch (err) {
    // Логируем реальную причину, клиенту отдаём нейтральное сообщение
    console.error('[GET /api/games] Ошибка при чтении истории:', err);
    res.status(500).json({ error: 'Не удалось получить историю игр' });
  }
});

/**
 * POST /api/games — сохранить результат завершённой партии.
 */
app.post('/api/games', (req, res) => {
  const validation = validateGameBody(req.body);

  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }

  try {
    const created = db.createGame(validation.data);
    return res.status(201).json(toApiGame(created));
  } catch (err) {
    console.error('[POST /api/games] Ошибка при сохранении партии:', err);
    return res.status(500).json({ error: 'Не удалось сохранить результат партии' });
  }
});

/**
 * DELETE /api/games — очистить всю историю игр.
 */
app.delete('/api/games', (req, res) => {
  try {
    const result = db.clearGames();
    res.status(200).json(result);
  } catch (err) {
    console.error('[DELETE /api/games] Ошибка при очистке истории:', err);
    res.status(500).json({ error: 'Не удалось очистить историю игр' });
  }
});

// ── Обработка несуществующих API-маршрутов ─────────────────────────────────

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Неизвестный API-маршрут' });
});

// ── Перехват ошибок парсера JSON ───────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Некорректный JSON в теле запроса' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(400).json({ error: 'Слишком большое тело запроса' });
  }

  console.error('Необработанная ошибка сервера:', err);
  return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

// ── Запуск сервера ────────────────────────────────────────────────────────

// Инициализируем БД ДО старта сервера: fail-fast при недоступной базе
try {
  db.initDb();
  console.log(`[db] База данных готова: ${db.DB_PATH}`);
} catch (err) {
  console.error('[db] Не удалось открыть базу данных:', err.message);
  console.error('[db] Проверьте права на файл database.sqlite или удалите его для пересоздания.');
  process.exit(1);
}

// Создаём сервер явно, чтобы перехватить ошибки запуска (например, занятый порт)
const server = app.listen(PORT, () => {
  console.log(`[server] Сервер запущен: http://localhost:${PORT}`);
});

// Ошибки запуска: порт занят или нет прав — сообщаем по-человечески, а не стеком
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[server] Порт ${PORT} уже занят другим процессом.`);
    console.error('[server] Варианты решения:');
    console.error(`[server]   1) Остановить старый сервер:  pkill -f "node server.js"`);
    console.error(`[server]   2) Запустить на другом порту:   PORT=5000 npm start`);
    console.error(`[server]   3] Узнать, кто занимает порт:  lsof -nP -iTCP:${PORT} -sTCP:LISTEN`);
    console.error('[server] Если сервер уже запущен в другом окне — просто откройте http://localhost:3000\n');
    process.exit(1);
  }

  console.error('[server] Не удалось запустить сервер:', err.message);
  process.exit(1);
});

// Корректно закрываем БД при остановке процесса
process.on('SIGINT', () => {
  try {
    db.getDb().close();
  } catch (_) {
    // Закрытие уже могло произойти — игнорируем
  }
  process.exit(0);
});

module.exports = app;