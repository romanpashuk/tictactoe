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
  'game-player', 'turn-indicator', 'board', 'play-again', 'toast',
  'mode-ai', 'mode-duo', 'mode-hint', 'player1-label',
  'player2-field', 'player2-name'
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
  getState: () => ({ isGameActive, currentTurn, gameMode, xPlayerName, oPlayerName })
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
  check('имя игрока передано в состояние', game.getState().xPlayerName === PLAYER);
  check('режим партии — против компьютера', game.getState().gameMode === 'ai');
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
    check('имя сохранено верно', body.x_name === PLAYER);
    check('в POST режим ai и o_name = Компьютер', body.mode === 'ai' && body.o_name === 'Компьютер');
    check('сохранённый результат совпадает с исходом партии', body.result === expectedResult);
  }

  // Запись появилась в базе
  const listResponse = await realFetch(`${BASE_URL}/api/games`);
  const games = await listResponse.json();
  const ourRecord = games.find((g) => g.x_name === PLAYER);

  check('запись появилась в истории', Array.isArray(games) && Boolean(ourRecord));
  check('в базе лежит правильное имя', Boolean(ourRecord) && ourRecord.x_name === PLAYER);
  check('в базе лежит верный результат', Boolean(ourRecord) && ourRecord.result === expectedResult);
  check('запись помечена режимом ai', Boolean(ourRecord) && ourRecord.mode === 'ai');
  check('в базе проставлена дата', Boolean(ourRecord) && Boolean(ourRecord.played_at));
  check('в базе проставлен id', Boolean(ourRecord) && Number.isInteger(ourRecord.id));
  // Совместимость с ТЗ: GET отдаёт legacy-поле player_name (= имя X)
  check('ответ содержит player_name из ТЗ', Boolean(ourRecord) && ourRecord.player_name === PLAYER);
  // XSS: имя со спецсимволами сохраняется как текст, а не исполняется

  await realFetch(`${BASE_URL}/api/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x_name: '<script>alert(1)</script>', mode: 'ai', result: 'lose' })
  });

  const listAfterXss = await (await realFetch(`${BASE_URL}/api/games`)).json();
  const xssRecord = listAfterXss.find((g) => g.x_name.includes('<script>'));
  check('имя с <script> сохранено дословно', Boolean(xssRecord));
  check('имя с <script> не изменено', xssRecord && xssRecord.x_name === '<script>alert(1)</script>');
  
  // ── Совместимость с ТЗ: legacy-формат {player_name, result} ─────────────

  console.log('\nСовместимость с ТЗ (legacy POST):');

  const legacyResponse = await realFetch(`${BASE_URL}/api/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ player_name: 'Легаси', result: 'draw' })
  });
  const legacyBody = await legacyResponse.json();

  check('legacy-формат ТЗ принят (201)', legacyResponse.status === 201);
  check(
    'legacy: mode=ai, o_name подставлен',
    legacyBody.mode === 'ai' && legacyBody.o_name === 'Компьютер'
  );
  check('legacy: player_name присутствует в ответе', legacyBody.player_name === 'Легаси');

  // ── Сценарий 2: режим «2 игрока» ─────────────────────────────────────────

  console.log('\nСквозная проверка режима «2 игрока»:');

  els['mode-duo'].checked = true;
  els['player-name'].value = 'Алиса';
  els['player2-name'].value = 'Борис';
  game.startGame();

  check(
    'duo: партия запущена в режиме duo',
    game.getState().gameMode === 'duo' && game.getState().isGameActive === true
  );
  check(
    'duo: оба игрока в состоянии',
    game.getState().xPlayerName === 'Алиса' && game.getState().oPlayerName === 'Борис'
  );

  // Играем по очереди: задержки ИИ нет, ходы делаются подряд
  for (let i = 0; i < 9; i += 1) {
    if (!game.getState().isGameActive) {
      break;
    }
    const freeCell = game.getBoard().findIndex((cell) => cell === '');
    if (freeCell === -1) {
      break;
    }
    game.handleCellClick(freeCell);
    await sleep(50);
  }

  const duoBoard = game.getBoard();

  // Ожидаемый результат — из финального поля (победа X → win, O → lose)
  const LINES_DUO = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];
  const hasLineOn = (cells, mark) => LINES_DUO.some(
    ([a, b, c]) => cells[a] === mark && cells[b] === mark && cells[c] === mark
  );

  let expectedDuo = 'draw';
  if (hasLineOn(duoBoard, 'X')) {
    expectedDuo = 'win';
  } else if (hasLineOn(duoBoard, 'O')) {
    expectedDuo = 'lose';
  }

  check('duo: партия завершена', game.getState().isGameActive === false);
  check(
    'duo: ходили двое (на поле есть X и O от кликов)',
    duoBoard.includes('X') && duoBoard.includes('O')
  );

  await sleep(500);
  check('duo: второй POST отправлен', createdBodies.length === 2);

  if (createdBodies.length >= 2) {
    const body2 = JSON.parse(createdBodies[1]);
    check(
      'duo: в POST режим и оба имени',
      body2.mode === 'duo' && body2.x_name === 'Алиса' && body2.o_name === 'Борис'
    );
    check('duo: результат соответствует полю', body2.result === expectedDuo);
  }

  const listDuo = await (await realFetch(`${BASE_URL}/api/games`)).json();
  const duoRecord = listDuo.find((g) => g.x_name === 'Алиса' && g.mode === 'duo');

  check('duo: запись появилась в истории', Boolean(duoRecord));
  check('duo: в записи два игрока', Boolean(duoRecord) && duoRecord.o_name === 'Борис');
  check('duo: верный результат', Boolean(duoRecord) && duoRecord.result === expectedDuo);

  // ── Итог ──────────────────────────────────────────────────────────────────
  
  console.log(`\nИтог: успешно ${passed}, провалено ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Сквозной тест упал с ошибкой:", err);
  process.exit(1);
});
