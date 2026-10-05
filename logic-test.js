/**
 * logic-test.js — проверка клиентской игровой логики без браузера.
 *
 * Загружает РЕАЛЬНЫЙ public/script.js в виртуальное окружение (vm) с заглушками
 * DOM и проверяет: определение победы/ничьей, работу ИИ, защиту от неверных
 * ходов, валидацию имени и форматирование даты.
 *
 * Запуск: node logic-test.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

// Тела всех POST-запросов клиента — чтобы проверять автосохранение результатов
const postedBodies = [];

const sandbox = {
  document: {
    getElementById: (id) => els[id] || createEl(),
    createElement: () => createEl()
  },
  window: { scrollTo() {}, confirm: () => true },
  fetch: async (url, options = {}) => {
    if (options.method === 'POST') {
      postedBodies.push(options.body);
    }
    return { ok: true, status: 201, text: async () => '{}' };
  },
  setTimeout: () => 0,
  clearTimeout: () => {},
  console
};

// ── Загрузка реального клиентского скрипта ────────────────────────────────

const source = fs.readFileSync(path.join(__dirname, 'public', 'script.js'), 'utf8');

// В vm объявления верхнего уровня не попадают в globalThis,
// поэтому экспортируем нужное явно в конце исходника
const EXPORTS = `
;globalThis.__game = {
  evaluateGameState,
  getWinningLine,
  findBestMove,
  validateName,
  formatDate,
  handleCellClick,
  startGame,
  setBoard: (cells) => { board = cells.slice(); },
  getBoard: () => board.slice(),
  getState: () => ({ isGameActive, currentTurn, isThinking, gameMode, xPlayerName, oPlayerName }),
  setState: (patch) => {
    if ('isGameActive' in patch) isGameActive = patch.isGameActive;
    if ('currentTurn' in patch) currentTurn = patch.currentTurn;
    if ('isThinking' in patch) isThinking = patch.isThinking;
    if ('gameMode' in patch) gameMode = patch.gameMode;
  }
};
`;

vm.createContext(sandbox);
vm.runInContext(source + EXPORTS, sandbox);

// Доступ к экспортированным функциям клиентского скрипта
const game = sandbox.__game;

// ── Мини-фреймворк ───────────────────────────────────────────────────────

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

/** Задать поле напрямую (симуляция состояния партии). */
function setBoard(cells) {
  game.setBoard(cells);
}

/** Задать поле и сразу оценить состояние партии. */
function evaluate(cells) {
  setBoard(cells);
  return game.evaluateGameState();
}

// ── Определение победы и ничьей ──────────────────────────────────────────

console.log('\nОпределение победы и ничьей:');

check(
  'победа по горизонтали распознаётся',
  evaluate(['X', 'X', 'X', '', '', '', '', '', '']) === true
);
check('после победы партия неактивна', game.getState().isGameActive === false);

check(
  'победа по вертикали распознаётся',
  evaluate(['', '', '', 'O', 'O', 'O', '', '', '']) === true
);

check(
  'победа по главной диагонали распознаётся',
  evaluate(['X', '', '', '', 'X', '', '', '', 'X']) === true
);

check(
  'победа по побочной диагонали распознаётся',
  evaluate(['', '', 'X', '', 'X', '', 'X', '', '']) === true
);

// Ничья: поле заполнено, победителя нет
check(
  'ничья распознаётся при заполненном поле',
  evaluate(['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X']) === true
);

check(
  'незавершённая партия не считается завершённой',
  evaluate(['X', '', '', '', '', '', '', '', '']) === false
);

// ── Работа ИИ ────────────────────────────────────────────────────────────

console.log('\nИИ компьютера:');

// Компьютер выигрывает немедленно
setBoard(['O', 'O', '', 'X', 'X', '', '', '', '']);
check('ИИ выбирает победную клетку', game.findBestMove() === 2);

// ИИ блокирует угрозу игрока
setBoard(['X', 'X', '', 'O', '', '', '', '', '']);
check('ИИ блокирует выигрыш игрока', game.findBestMove() === 2);

// Пустое поле — центр
setBoard(['', '', '', '', '', '', '', '', '']);
check('на пустом поле ИИ выбирает центр', game.findBestMove() === 4);

// Центр занят — угол
setBoard(['', '', '', '', 'X', '', '', '', '']);
check('при занятом центре ИИ выбирает угол', [0, 2, 6, 8].includes(game.findBestMove()));

// Приоритет победы важнее блокировки
setBoard(['O', 'O', '', 'X', 'X', '', 'X', '', '']);
check('победа важнее блокировки', game.findBestMove() === 2);

// Заполненное поле — ходов нет
setBoard(['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X']);
check('на заполненном поле ходов нет', game.findBestMove() === -1);

// ── Защита от неверных ходов ──────────────────────────────────────────────

console.log('\nЗащита от неверных ходов:');

// Состояние: партия идёт, ходит игрок (X), в клетке 0 уже стоит X
setBoard(['X', '', '', '', '', '', '', '', '']);
game.setState({ isGameActive: true, currentTurn: 'X', isThinking: false });

// Клик по занятой клетке не меняет поле
game.handleCellClick(0);
check(
  'клик по занятой клетке игнорируется',
  game.getBoard()[0] === 'X' && game.getBoard().filter(Boolean).length === 1
);

// Клик, когда ходит компьютер, игнорируется
game.setState({ currentTurn: 'O' });
game.handleCellClick(5);
check('клик вне хода игрока игнорируется', game.getBoard()[5] === '');

// Клик при завершённой игре игнорируется
game.setState({ currentTurn: 'X', isGameActive: false });
game.handleCellClick(5);
check('клик после конца игры игнорируется', game.getBoard()[5] === '');

// Клик во время хода компьютера игнорируется
game.setState({ isGameActive: true, isThinking: true });
game.handleCellClick(5);
check('клик во время хода компьютера игнорируется', game.getBoard()[5] === '');

// ── Валидация имени на клиенте ────────────────────────────────────────────

console.log('\nВалидация имени на клиенте:');

els['player-name'].value = '';
check('пустое имя отклоняется', game.validateName() === false);

els['player-name'].value = '   ';
check('имя из пробелов отклоняется', game.validateName() === false);

els['player-name'].value = 'A'.repeat(30);
check('имя в 30 символов принимается', game.validateName() === true);

els['player-name'].value = 'A'.repeat(31);
check('имя в 31 символ отклоняется', game.validateName() === false);

els['player-name'].value = '  Алиса  ';
check('имя с пробелами по краям принимается', game.validateName() === true);

// ── Режим «2 игрока» ─────────────────────────────────────────────────────

console.log('\nРежим «2 игрока»:');

els['mode-duo'].checked = true;
els['player-name'].value = 'Алиса';
els['player2-name'].value = '';

check('duo: пустое имя второго игрока отклоняется', game.validateName() === false);

els['player2-name'].value = 'B'.repeat(31);
check('duo: имя второго игрока длиннее 30 символов отклоняется', game.validateName() === false);

els['player2-name'].value = 'Борис';
check('duo: два корректных имени принимаются', game.validateName() === true);

// Запуск партии в режиме «2 игрока»
game.startGame();
check(
  'duo: партия запущена в режиме duo',
  game.getState().gameMode === 'duo' && game.getState().isGameActive === true
);
check(
  'duo: оба имени сохранены в состоянии',
  game.getState().xPlayerName === 'Алиса' && game.getState().oPlayerName === 'Борис'
);
check('duo: первым ходит X', game.getState().currentTurn === 'X');

// Ходы двух людей: без задержки ИИ, поле остаётся активным
game.handleCellClick(0);
check(
  'duo: после хода X очередь переходит к O',
  game.getBoard()[0] === 'X' && game.getState().currentTurn === 'O'
);
check('duo: поле не блокируется на «раздумье» ИИ', game.getState().isThinking === false);

game.handleCellClick(4);
check(
  'duo: после хода O очередь возвращается к X',
  game.getBoard()[4] === 'O' && game.getState().currentTurn === 'X'
);

// Занятая клетка игнорируется в любом режиме
game.handleCellClick(4);
check('duo: клик по занятой клетке игнорируется', game.getBoard().filter(Boolean).length === 2);

// Победа O сохраняется как result='lose' (победил игрок O) с именами обоих
game.setBoard(['O', 'O', 'O', '', '', '', '', '', '']);
check('duo: победа O определяется', game.evaluateGameState() === true);
check('duo: результат партии сохранён одним POST', postedBodies.length === 1);

if (postedBodies.length === 1) {
  const body = JSON.parse(postedBodies[0]);
  check(
    'duo: в POST режим и оба имени',
    body.mode === 'duo' && body.x_name === 'Алиса' && body.o_name === 'Борис'
  );
  check('duo: результат — победа O (lose)', body.result === 'lose');
}

// Защита MINOR-5: повторная оценка завершённой партии не шлёт второй POST
game.evaluateGameState();
check('повторная оценка не создаёт дубль POST (MINOR-5)', postedBodies.length === 1);

// Возврат в режим ИИ не ломает валидацию одного имени
els['mode-duo'].checked = false;
els['player2-name'].value = '';
check('после возврата в ИИ второй игрок не требуется', game.validateName() === true);


// ── Форматирование даты ───────────────────────────────────────────────────

console.log('\nФорматирование даты:');

check(
  'дата SQLite форматируется в ДД.ММ.ГГГГ',
  /^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/.test(game.formatDate('2026-10-05 14:03:21'))
);
check('некорректная дата не ломает вывод', game.formatDate('мусор') === 'мусор');

// ── Итог ──────────────────────────────────────────────────────────────────

console.log(`\nИтог: успешно ${passed}, провалено ${failed}`);
process.exit(failed === 0 ? 0 : 1);