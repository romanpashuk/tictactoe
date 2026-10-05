/**
 * db.js — слой доступа к данным (DATA-слой).
 *
 * Здесь и ТОЛЬКО здесь живёт SQL-код приложения (см. ARCHITECTURE.md, раздел 6).
 * Модуль не знает ничего про Express и HTTP: наружу отдаёт простые функции,
 * которые вызывает серверный слой server.js.
 */

'use strict';

const path = require('path');
const Database = require('better-sqlite3');

// Путь к файлу БД в корне проекта.
// Переопределяется переменной окружения DB_PATH — это используется автотестами
// для проверки поведения при недоступной/повреждённой базе (corrupt-db-check.js).
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'database.sqlite');

// Максимальное количество игр, которое отдаёт listGames() (меню показывает 10)
const HISTORY_LIMIT = 10;

// Допустимые значения результата партии
const ALLOWED_RESULTS = ['win', 'lose', 'draw'];

// Экземпляр соединения с БД (создаётся в initDb())
let db = null;

/**
 * Инициализация базы данных: открытие файла, создание таблицы и индекса.
 * Идемпотентна — можно вызывать многократно (используется IF NOT EXISTS).
 *
 * @returns {import('better-sqlite3').Database} Соединение с БД.
 * @throws {Error} Если файл БД недоступен или схема некорректна.
 */
function initDb() {
  db = new Database(DB_PATH);

  // WAL-режим: устойчивость при параллельных запросах
  db.pragma('journal_mode = WAL');
  // Внешние ключи и корректная обработка NULL — по умолчанию
  db.pragma('foreign_keys = ON');

  // Создаём таблицу результатов партий
  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      player_name TEXT    NOT NULL
                          CHECK(length(trim(player_name)) BETWEEN 1 AND 30),
      result      TEXT    NOT NULL
                          CHECK(result IN ('win', 'lose', 'draw')),
      played_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Индекс для сортировки истории по дате (частый запрос списка)
  db.exec('CREATE INDEX IF NOT EXISTS idx_played_at ON games(played_at DESC);');

  return db;
}

/**
 * Получить экземпляр соединения (без повторной инициализации).
 * @returns {import('better-sqlite3').Database}
 */
function getDb() {
  if (!db) {
    // Если initDb() ещё не вызывали — инициализируем лениво
    return initDb();
  }
  return db;
}

/**
 * Получить последние игры, отсортированные по дате убывания.
 *
 * @param {number} [limit=HISTORY_LIMIT] Сколько записей вернуть.
 * @returns {Array<{id:number, player_name:string, result:string, played_at:string}>}
 */
function listGames(limit = HISTORY_LIMIT) {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : HISTORY_LIMIT;

  // Подготовленный запрос + параметр — защита от SQL-инъекции
  const query = getDb().prepare(`
    SELECT id, player_name, result, played_at
    FROM games
    ORDER BY played_at DESC, id DESC
    LIMIT ?
  `);

  return query.all(safeLimit);
}

/**
 * Добавить запись о завершённой партии.
 *
 * @param {{player_name: string, result: string}} game
 * @returns {{id:number, player_name:string, result:string, played_at:string}} Созданная запись.
 */
function createGame(game) {
  const { player_name: playerName, result } = game;

  // Финальная страховка на уровне слоя данных (CHECK в БД — второй рубеж)
  const trimmedName = String(playerName).trim();
  if (trimmedName.length < 1 || trimmedName.length > 30) {
    throw new Error('Некорректное имя игрока');
  }
  if (!ALLOWED_RESULTS.includes(result)) {
    throw new Error('Некорректный результат партии');
  }

  const query = getDb().prepare(`
    INSERT INTO games (player_name, result)
    VALUES (?, ?)
  `);

  const info = query.run(trimmedName, result);

  // Возвращаем полностью сформированную запись (id и played_at из БД)
  const row = getDb()
    .prepare('SELECT id, player_name, result, played_at FROM games WHERE id = ?')
    .get(info.lastInsertRowid);

  return row;
}

/**
 * Очистить всю историю игр.
 * @returns {{deleted:number}} Количество удалённых записей.
 */
function clearGames() {
  // Сначала считаем, чтобы сообщить пользователю, сколько записей удалено
  const { count } = getDb().prepare('SELECT COUNT(*) AS count FROM games').get();

  getDb().prepare('DELETE FROM games').run();

  return { deleted: count };
}

module.exports = {
  DB_PATH,
  HISTORY_LIMIT,
  ALLOWED_RESULTS,
  initDb,
  getDb,
  listGames,
  createGame,
  clearGames
};