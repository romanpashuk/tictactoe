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
  'game-player', 'turn-indicator', 'board', 'play-again', 'toast'
];

const els = {};
for (const id of ELEMENT_IDS) {
  els[id] = createEl();
}

const sandbox = {
  document: {
    getElementById: (id) => els[id] || createEl(),
    createElement: () => createEl()
  },
  window: { scrollTo() {}, confirm: () => true },
  fetch: async () => ({ ok: true, status: 200, text: async () => '[]' }),
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
  setBoard: (cells) => { board = cells.slice(); },
  getBoard: () => board.slice(),
  getState: () => ({ isGameActive, currentTurn, isThinking, playerName }),
  setState: (patch) => {
    if ('isGameActive' in patch) isGameActive = patch.isGameActive;
    if ('currentTurn' in patch) currentTurn = patch.currentTurn;
    if ('isThinking' in patch) isThinking = patch.isThinking;
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