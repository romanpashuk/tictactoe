/**
 * db-schema-check.js — проверка схемы БД и ограничений напрямую (роль Tester).
 *
 * Проверяет: структуру таблицы games, наличие индекса, работу CHECK-ограничений
 * на уровне самой базы (второй рубеж защиты после валидации в server.js).
 *
 * Запуск: node db-schema-check.js
 */

'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'database.sqlite');

let passed = 0;
let failed = 0;

function check(name, condition) {
  if (condition) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    console.log(`  ❌ ${name}`);
  }
}

const db = new Database(DB_PATH);

console.log('\nПроверка схемы БД:');

// ── Структура таблицы ─────────────────────────────────────────────────────

const columns = db.prepare('PRAGMA table_info(games)').all();
const colNames = columns.map((c) => c.name);

check('таблица games существует', colNames.length > 0);
check('есть колонка id', colNames.includes('id'));
check('есть колонка player_name', colNames.includes('player_name'));
check('есть колонка result', colNames.includes('result'));
check('есть колонка played_at', colNames.includes('played_at'));

const idCol = columns.find((c) => c.name === 'id');
check('id — PRIMARY KEY', idCol && idCol.pk === 1);

const nameCol = columns.find((c) => c.name === 'player_name');
check('player_name NOT NULL', nameCol && nameCol.notnull === 1);

const resultCol = columns.find((c) => c.name === 'result');
check('result NOT NULL', resultCol && resultCol.notnull === 1);

const playedAtCol = columns.find((c) => c.name === 'played_at');
check('played_at NOT NULL', playedAtCol && playedAtCol.notnull === 1);

// ── Индекс ────────────────────────────────────────────────────────────────

const indexes = db
  .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='games'")
  .all()
  .map((i) => i.name);

check('индекс idx_played_at существует', indexes.includes('idx_played_at'));

// ── CHECK-ограничения (второй рубеж) ──────────────────────────────────────

// Вставляем заведомо плохие записи напрямую в БД, в обход сервера
const insert = db.prepare('INSERT INTO games (player_name, result) VALUES (?, ?)');

function tryInsert(name, result) {
  try {
    insert.run(name, result);
    return true;
  } catch (_) {
    return false;
  }
}

check('CHECK отклоняет пустое имя', tryInsert('', 'win') === false);
check('CHECK отклоняет имя из 31 символа', tryInsert('C'.repeat(31), 'win') === false);
check('CHECK отклоняет неизвестный result', tryInsert('ok', 'bad') === false);
check('CHECK принимает корректную запись', tryInsert('Проверка', 'win') === true);
check('CHECK принимает имя ровно в 30 символов', tryInsert('D'.repeat(30), 'draw') === true);

// Убираем за собой тестовые записи
db.prepare("DELETE FROM games WHERE player_name IN ('Проверка', ?)")
  .run('D'.repeat(30));

// ── Автоинкремент id ──────────────────────────────────────────────────────

const maxBefore = db.prepare('SELECT MAX(id) AS m FROM games').get().m || 0;
insert.run('Автоинкремент', 'win');
const maxAfter = db.prepare('SELECT MAX(id) AS m FROM games').get().m;
db.prepare("DELETE FROM games WHERE player_name = 'Автоинкремент'").run();

check('id выдаётся автоматически (AUTOINCREMENT)', maxAfter > maxBefore);

db.close();

console.log(`\nИтог: успешно ${passed}, провалено ${failed}`);
process.exit(failed === 0 ? 0 : 1);