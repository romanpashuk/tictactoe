/**
 * e2e-game.js — сквозная проверка полного цикла партии.
 *
 * Играет партию через РЕАЛЬНУЮ клиентскую логику (public/script.js) с настоящим
 * сервером (API + SQLite): игрок ходит, компьютер отвечает, результат
 * сохраняется в базу и появляется в истории.
 *
 * Запуск: node server.js в одном терминале, затем node e2e-game.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const PLAYER = 'Тестер';

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

// ── Заглушка DOM ──────────────────────────────────────────────────────────

function createEl() {
  return {
    children: [],
    dataset: {},
    className: '',
    textContent: '',
    hidden: false,
    disabled: false,
    classList: { add() {}, remove() {} },
    addEventListener() {},
    setAttribute() {},
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren() { this.children = []; },
    scrollIntoView() {},
    focus() {}
  };
}

const ELEMENT_IDS = [
  'menu-screen', 'game-screen', 'player-name', 'name-error', 'start-game',
  'clear-history', 'history-table', 'history-body', 'history-empty',
  'game-player', 'turn-indicator', 'board', 'play-again', 'toast'
];

const els = {};
for (const id of ELEMENT_IDS) {
  els[id] = createEl();
}

// ── Сеть: настоящий fetch к запущенному серверу ───────────────────────────

const createdBodies = [];
const realFetch = globalThis.fetch;

async function trackingFetch(url, options = {}) {
  // Запоминаем POST-запросы, чтобы проверить автосохранение результата
  if (options.method === 'POST') {
    createdBodies.push(options.body);
  }

  // Клиент использует относительные пути ('/api/games'), а Node fetch
  // требует абсолютный URL — приводим путь к полному адресу сервера
  const absoluteUrl = url.startsWith('http') ? url : `${BASE_URL}${url}`;

  return realFetch(absoluteUrl, options);
}

const sandbox = {
  document: {
    getElementById: (id) => els[id] || createEl(),
    createElement: () => createEl()
  },
  window: { scrollTo() {}, confirm: () => true },
  fetch: trackingFetch,
  setTimeout,
  clearTimeout,
  console
};

const source = fs.readFileSync(path.join(__dirname, 'public', 'script.js'), 'utf8');

const EXPORTS = `
;globalThis.__game = {
  handleCellClick,
  startGame,
  getBoard: () => board.slice(),
  getState: () => ({ isGameActive, currentTurn, playerName })
};
`;

vm.createContext(sandbox);
vm.runInContext(source + EXPORTS, sandbox);

const game = sandbox.__game;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Основной сценарий ─────────────────────────────────────────────────────

async function main() {
  // ── Подготовка: чистим историю, чтобы отследить только свою запись ───────

  console.log('\nСквозная проверка партии:');
  
  const cleared = await realFetch(`${BASE_URL}/api/games`, { method: 'DELETE' });
  check('история очищена перед тестом', cleared.ok === true);
  
  // ── Запуск партии ─────────────────────────────────────────────────────────
  
  els['player-name'].value = PLAYER;
  game.startGame();
  
  check('партия запущена', game.getState().isGameActive === true);
  check('имя игрока передано в состояние', game.getState().playerName === PLAYER);
  check('поле пустое на старте', game.getBoard().every((c) => c === ''));
  check('первый ход принадлежит игроку (X)', game.getState().currentTurn === 'X');
  // ── Играем партию до победы ────────────────────────────────────────────
  // Компьютер отвечает автоматически между ходами (AI_DELAY_MS = 400 мс).
  // Ходим по свободным клеткам и каждый раз ждём ответа компьютера.

  const sleepBetweenMoves = 600;

  for (let attempt = 0; attempt < 9; attempt += 1) {
    // Партия уже закончилась — выходим из цикла
    if (!game.getState().isGameActive) {
      break;
    }

    // Выбираем первую свободную клетку
    const freeCell = game.getBoard().findIndex((cell) => cell === '');

    if (freeCell === -1) {
      break;
    }

    game.handleCellClick(freeCell);
    await sleep(sleepBetweenMoves);
  }

  // Итог партии выводим из финального поля
  const finalBoard = game.getBoard();
  const LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];

  const hasLine = (mark) => LINES.some(
    ([a, b, c]) => finalBoard[a] === mark && finalBoard[b] === mark && finalBoard[c] === mark
  );

  // Ожидаемый результат однозначно следует из финального поля
  let expectedResult = 'draw';
  if (hasLine('X')) {
    expectedResult = 'win';
  } else if (hasLine('O')) {
    expectedResult = 'lose';
  }

  check('партия завершена', game.getState().isGameActive === false);
  check('компьютер сыграл в ответ (есть O)', finalBoard.includes('O'));
  check('итог партии однозначно выводится из поля', ['win', 'lose', 'draw'].includes(expectedResult));

  // Автосохранение результата — проверяем через реальный API
  await sleep(500);
  check('POST результата был отправлен', createdBodies.length === 1);

  if (createdBodies.length > 0) {
    const body = JSON.parse(createdBodies[0]);
    check('имя сохранено верно', body.player_name === PLAYER);
    check('сохранённый результат совпадает с исходом партии', body.result === expectedResult);
  }

  // Запись появилась в базе
  const listResponse = await realFetch(`${BASE_URL}/api/games`);
  const games = await listResponse.json();
  const ourRecord = games.find((g) => g.player_name === PLAYER);

  check('запись появилась в истории', Array.isArray(games) && Boolean(ourRecord));
  check('в базе лежит правильное имя', Boolean(ourRecord) && ourRecord.player_name === PLAYER);
  check('в базе лежит верный результат', Boolean(ourRecord) && ourRecord.result === expectedResult);
  check('в базе проставлена дата', Boolean(ourRecord) && Boolean(ourRecord.played_at));
  check('в базе проставлен id', Boolean(ourRecord) && Number.isInteger(ourRecord.id));  
  // XSS: имя со спецсимволами сохраняется как текст, а не исполняется

  await realFetch(`${BASE_URL}/api/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ player_name: '<script>alert(1)</script>', result: 'lose' })
  });
  
  const listAfterXss = await (await realFetch(`${BASE_URL}/api/games`)).json();
  const xssRecord = listAfterXss.find((g) => g.player_name.includes('<script>'));
  check('имя с <script> сохранено дословно', Boolean(xssRecord));
  check('имя с <script> не изменено', xssRecord && xssRecord.player_name === '<script>alert(1)</script>');
  
  // ── Итог ──────────────────────────────────────────────────────────────────
  
  console.log(`\nИтог: успешно ${passed}, провалено ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Сквозной тест упал с ошибкой:", err);
  process.exit(1);
});
