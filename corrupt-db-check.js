/**
 * corrupt-db-check.js — проверка поведения при недоступной/повреждённой БД.
 *
 * Требование из ARCHITECTURE.md (раздел 3.4): при ошибке открытия БД на старте
 * приложение должно завершиться с кодом 1 (fail-fast), а не работать вслепую.
 *
 * Тест запускает НАСТОЯЩИЙ db.js в отдельном процессе, подставляя путь к БД
 * через переменную окружения DB_PATH, и проверяет сценарии:
 *   1) испорченный файл БД → initDb() обязан бросить исключение
 *   2) недоступный каталог → initDb() не должен проходить успешно
 *   3) чистое место         → initDb() проходит, файл БД создаётся
 *   4) битая БД не затирается молча (нет потери данных)
 *
 * Запуск: node corrupt-db-check.js
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

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

// Сценарий, выполняемый в отдельном процессе: вызывает реальный db.js
const PROBE = `
  const db = require(process.argv[2]);
  try {
    db.initDb();
    console.log('RESULT:NO_ERROR');
  } catch (err) {
    console.log('RESULT:THROWN:' + err.message.slice(0, 60));
  }
`;

const dbModulePath = path.join(__dirname, 'db.js');
const probePath = path.join(os.tmpdir(), `ttt-probe-${process.pid}.js`);
fs.writeFileSync(probePath, PROBE, 'utf8');

/**
 * Запустить сценарий с указанным путём к БД.
 * @param {string} dbPath Путь к файлу БД.
 * @returns {string} Сырой вывод процесса.
 */
function runProbe(dbPath) {
  try {
    return execFileSync(process.execPath, [probePath, dbModulePath], {
      cwd: __dirname,
      encoding: 'utf8',
      env: { ...process.env, DB_PATH: dbPath },
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (err) {
    return `RESULT:PROCESS_ERROR:${(err.stderr || err.message).slice(0, 80)}`;
  }
}

const tempDirs = [];

console.log('\nПоведение при повреждённой БД:');

// ── Сценарий 1: испорченный файл БД ───────────────────────────────────────

const corruptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttt-corrupt-'));
tempDirs.push(corruptDir);
const corruptDbPath = path.join(corruptDir, 'database.sqlite');
fs.writeFileSync(corruptDbPath, 'this is not a sqlite database', 'utf8');

const corruptOut = runProbe(corruptDbPath);
console.log(`  (сырой вывод: ${corruptOut.trim()})`);

check('initDb() бросает исключение на битом файле', corruptOut.includes('RESULT:THROWN'));
check(
  'сообщение об ошибке понятно (file is not a database)',
  corruptOut.includes('file is not a database')
);

// ── Сценарий 2: БД недоступна (каталог только для чтения) ────────────────

const noPermDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttt-noperm-'));
tempDirs.push(noPermDir);

// Каталог заполняем заранее, потом закрываем права на запись
fs.writeFileSync(path.join(noPermDir, 'placeholder'), 'x', 'utf8');
const noPermDbPath = path.join(noPermDir, 'database.sqlite');
fs.chmodSync(noPermDir, 0o500); // читать можно, писать — нет

const noPermOut = runProbe(noPermDbPath);
fs.chmodSync(noPermDir, 0o700); // возвращаем права для удаления

console.log(`  (сырой вывод: ${noPermOut.trim()})`);
check(
  'при недоступной БД initDb() не проходит успешно',
  !noPermOut.includes('RESULT:NO_ERROR')
);

// ── Сценарий 3: чистое место — БД создаётся с нуля ─────────────────────────

const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttt-fresh-'));
tempDirs.push(freshDir);
const freshDbPath = path.join(freshDir, 'database.sqlite');

const freshOut = runProbe(freshDbPath);
console.log(`  (сырой вывод: ${freshOut.trim()})`);

check('на чистом месте initDb() проходит без ошибок', freshOut.includes('RESULT:NO_ERROR'));
check('файл БД создан автоматически', fs.existsSync(freshDbPath));

// ── Сценарий 4: битая БД не перезаписана молча ────────────────────────────
// Если бы приложение молча создавало новую базу поверх битой, данные
// пользователя потерялись бы без предупреждения.
check(
  'битая БД не перезаписана автоматически (нет молчаливой потери данных)',
  fs.readFileSync(corruptDbPath, 'utf8') === 'this is not a sqlite database'
);

// Убираем временные файлы
fs.rmSync(probePath, { force: true });
for (const dir of tempDirs) {
  try {
    fs.chmodSync(dir, 0o700);
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {
    // Не смогли удалить временную папку — не влияет на результат теста
  }
}

console.log(`\nИтог: успешно ${passed}, провалено ${failed}`);
process.exit(failed === 0 ? 0 : 1);