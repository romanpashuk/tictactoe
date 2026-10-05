/**
 * db-schema-check.js — проверка схемы БД и ограничений напрямую (роль Tester).
 *
 * Проверяет: структуру таблицы games, наличие индекса, работу CHECK-ограничений
 * на уровне самой базы (второй рубеж защиты после валидации в server.js).
 *
 * Запуск: node db-schema-check.js
 */

'use strict';

const fs = require('fs');
const os = require('os');
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

// Инициализируем схему через НАСТОЯЩИЙ db.js — ровно то же, что делает сервер
// на старте. На старой БД (v1 с player_name) при этом выполняется миграция.
process.env.DB_PATH = DB_PATH;
const dbModule = require('./db');
dbModule.initDb();

const db = new Database(DB_PATH);

console.log('\nПроверка схемы БД:');

// ── Структура таблицы ─────────────────────────────────────────────────────

const columns = db.prepare('PRAGMA table_info(games)').all();
const colNames = columns.map((c) => c.name);

check('таблица games существует', colNames.length > 0);
check('есть колонка id', colNames.includes('id'));
check('есть колонка x_name', colNames.includes('x_name'));
check('есть колонка o_name', colNames.includes('o_name'));
check('есть колонка mode', colNames.includes('mode'));
check('есть колонка result', colNames.includes('result'));
check('есть колонка played_at', colNames.includes('played_at'));

const idCol = columns.find((c) => c.name === 'id');
check('id — PRIMARY KEY', idCol && idCol.pk === 1);

const xNameCol = columns.find((c) => c.name === 'x_name');
check('x_name NOT NULL', xNameCol && xNameCol.notnull === 1);

const oNameCol = columns.find((c) => c.name === 'o_name');
check('o_name NOT NULL', oNameCol && oNameCol.notnull === 1);

const modeCol = columns.find((c) => c.name === 'mode');
check('mode NOT NULL', modeCol && modeCol.notnull === 1);

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
const insert = db.prepare(
  'INSERT INTO games (x_name, o_name, mode, result) VALUES (?, ?, ?, ?)'
);

function tryInsert(xName, oName, mode, result) {
  try {
    insert.run(xName, oName, mode, result);
    return true;
  } catch (_) {
    return false;
  }
}

check('CHECK отклоняет пустое имя X', tryInsert('', 'Компьютер', 'ai', 'win') === false);
check('CHECK отклоняет пустое имя O', tryInsert('Алиса', '', 'duo', 'win') === false);
check('CHECK отклоняет имя X из 31 символа', tryInsert('C'.repeat(31), 'Компьютер', 'ai', 'win') === false);
check('CHECK отклоняет неизвестный mode', tryInsert('Алиса', 'Борис', 'network', 'win') === false);
check('CHECK отклоняет неизвестный result', tryInsert('ok', 'ok2', 'ai', 'bad') === false);
check('CHECK принимает корректную ai-запись', tryInsert('Проверка', 'Компьютер', 'ai', 'win') === true);
check('CHECK принимает корректную duo-запись', tryInsert('Алиса', 'Борис', 'duo', 'draw') === true);
check('CHECK принимает имена ровно в 30 символов', tryInsert('D'.repeat(30), 'E'.repeat(30), 'duo', 'draw') === true);

// Убираем за собой тестовые записи
db.prepare('DELETE FROM games WHERE x_name IN (?, ?, ?)')
  .run('Проверка', 'Алиса', 'D'.repeat(30));

// ── Автоинкремент id ──────────────────────────────────────────────────────

const maxBefore = db.prepare('SELECT MAX(id) AS m FROM games').get().m || 0;
insert.run('Автоинкремент', 'Компьютер', 'ai', 'win');
const maxAfter = db.prepare('SELECT MAX(id) AS m FROM games').get().m;
db.prepare("DELETE FROM games WHERE x_name = 'Автоинкремент'").run();

check('id выдаётся автоматически (AUTOINCREMENT)', maxAfter > maxBefore);

// ── Миграция v1 (player_name) → v2 (x_name, o_name, mode) ────────────────

console.log('\nМиграция схемы v1 → v2:');

const migDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttt-mig-'));
const migPath = path.join(migDir, 'database.sqlite');

// Вручную создаём БД старого формата с одной записью
const v1 = new Database(migPath);
v1.exec(`
  CREATE TABLE games (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    player_name TEXT    NOT NULL
                        CHECK(length(trim(player_name)) BETWEEN 1 AND 30),
    result      TEXT    NOT NULL
                        CHECK(result IN ('win', 'lose', 'draw')),
    played_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);
v1.prepare('INSERT INTO games (player_name, result) VALUES (?, ?)').run('Старый игрок', 'win');
v1.close();

// Запускаем реальный initDb() на старой базе (db.js читает DB_PATH при загрузке,
// поэтому перечитываем модуль через сброс кэша require)
process.env.DB_PATH = migPath;
delete require.cache[require.resolve('./db.js')];
const dbV2 = require('./db');
dbV2.initDb();

const migColNames = dbV2
  .getDb()
  .prepare('PRAGMA table_info(games)')
  .all()
  .map((c) => c.name);

check(
  'миграция: появились колонки x_name, o_name, mode',
  migColNames.includes('x_name') && migColNames.includes('o_name') && migColNames.includes('mode')
);
check('миграция: колонка player_name удалена', !migColNames.includes('player_name'));

const migrated = dbV2.listGames();
check('миграция: запись сохранилась', migrated.length === 1);

if (migrated.length === 1) {
  const row = migrated[0];
  check('миграция: имя перенесено в x_name', row.x_name === 'Старый игрок');
  check(
    'миграция: ИИ-партия получила o_name = Компьютер и mode = ai',
    row.o_name === 'Компьютер' && row.mode === 'ai'
  );
  check('миграция: результат и id не изменились', row.result === 'win' && row.id === 1);
  check('миграция: дата сохранилась', Boolean(row.played_at));
}

// Повторный запуск на уже новой схеме — идемпотентен
delete require.cache[require.resolve('./db.js')];
const dbV2Again = require('./db');
dbV2Again.initDb();
check(
  'миграция идемпотентна (повторный initDb() не ломает данные)',
  dbV2Again.listGames().length === 1
);
dbV2Again.getDb().close();

// ── Итог ──────────────────────────────────────────────────────────────────

db.close();
try {
  dbModule.getDb().close();
} catch (_) {
  // Соединение могло уже закрыться — не влияет на результат теста
}

fs.rmSync(migDir, { recursive: true, force: true });

console.log(`\nИтог: успешно ${passed}, провалено ${failed}`);
process.exit(failed === 0 ? 0 : 1);