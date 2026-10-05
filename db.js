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

// Допустимые значения результата партии (с точки зрения X):
// win — победил X, lose — победил O, draw — ничья
const ALLOWED_RESULTS = ['win', 'lose', 'draw'];

// Допустимые режимы игры: 'ai' — против компьютера, 'duo' — двое за одним устройством
const ALLOWED_MODES = ['ai', 'duo'];

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

  // Создаём таблицу результатов партий (схема v2: два игрока + режим)
  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      x_name    TEXT    NOT NULL
                        CHECK(length(trim(x_name)) BETWEEN 1 AND 30),
      o_name    TEXT    NOT NULL
                        CHECK(length(trim(o_name)) BETWEEN 1 AND 30),
      mode      TEXT    NOT NULL DEFAULT 'ai'
                        CHECK(mode IN ('ai', 'duo')),
      result    TEXT    NOT NULL
                        CHECK(result IN ('win', 'lose', 'draw')),
      played_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Старые БД (схема v1 с player_name) переводим на v2, сохранив данные
  migrateV1toV2();

  // Индекс для сортировки истории по дате (частый запрос списка)
  db.exec('CREATE INDEX IF NOT EXISTS idx_played_at ON games(played_at DESC);');

  return db;
}

/**
 * Миграция схемы v1 (player_name) → v2 (x_name, o_name, mode).
 *
 * SQLite не позволяет менять CHECK-ограничения, поэтому таблица пересоздаётся:
 * старые записи копируются с сохранением id и даты, ИИ-партии получают
 * o_name = 'Компьютер' и mode = 'ai'. Идемпотентна: на v2-схеме не делает ничего.
 */
function migrateV1toV2() {
  const columns = db.prepare('PRAGMA table_info(games)').all().map((c) => c.name);

  // Таблица уже в новой формате (или только что создана) — миграция не нужна
  if (!columns.includes('player_name') || columns.includes('x_name')) {
    return;
  }

  db.exec(`
    CREATE TABLE games_migrated (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      x_name    TEXT    NOT NULL
                        CHECK(length(trim(x_name)) BETWEEN 1 AND 30),
      o_name    TEXT    NOT NULL
                        CHECK(length(trim(o_name)) BETWEEN 1 AND 30),
      mode      TEXT    NOT NULL DEFAULT 'ai'
                        CHECK(mode IN ('ai', 'duo')),
      result    TEXT    NOT NULL
                        CHECK(result IN ('win', 'lose', 'draw')),
      played_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    INSERT INTO games_migrated (id, x_name, o_name, mode, result, played_at)
      SELECT id, player_name, 'Компьютер', 'ai', result, played_at FROM games;

    DROP TABLE games;

    ALTER TABLE games_migrated RENAME TO games;
  `);

  console.log('[db] Миграция схемы: player_name → x_name/o_name (данные сохранены)');
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
 * @returns {Array<{id:number, x_name:string, o_name:string, mode:string, result:string, played_at:string}>}
 */
function listGames(limit = HISTORY_LIMIT) {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : HISTORY_LIMIT;

  // Подготовленный запрос + параметр — защита от SQL-инъекции
  const query = getDb().prepare(`
    SELECT id, x_name, o_name, mode, result, played_at
    FROM games
    ORDER BY played_at DESC, id DESC
    LIMIT ?
  `);

  return query.all(safeLimit);
}

/**
 * Добавить запись о завершённой партии.
 *
 * @param {{x_name: string, o_name: string, mode?: string, result: string}} game
 * @returns {{id:number, x_name:string, o_name:string, mode:string, result:string, played_at:string}} Созданная запись.
 */
function createGame(game) {
  const { x_name: rawX, o_name: rawO, mode = 'ai', result } = game;

  // Финальная страховка на уровне слоя данных (CHECK в БД — второй рубеж)
  const xName = String(rawX).trim();
  const oName = String(rawO).trim();
  if (xName.length < 1 || xName.length > 30) {
    throw new Error('Некорректное имя игрока X');
  }
  if (oName.length < 1 || oName.length > 30) {
    throw new Error('Некорректное имя игрока O');
  }
  if (!ALLOWED_MODES.includes(mode)) {
    throw new Error('Некорректный режим игры');
  }
  if (!ALLOWED_RESULTS.includes(result)) {
    throw new Error('Некорректный результат партии');
  }

  const query = getDb().prepare(`
    INSERT INTO games (x_name, o_name, mode, result)
    VALUES (?, ?, ?, ?)
  `);

  const info = query.run(xName, oName, mode, result);

  // Возвращаем полностью сформированную запись (id и played_at из БД)
  const row = getDb()
    .prepare('SELECT id, x_name, o_name, mode, result, played_at FROM games WHERE id = ?')
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
  ALLOWED_MODES,
  initDb,
  getDb,
  listGames,
  createGame,
  clearGames
};