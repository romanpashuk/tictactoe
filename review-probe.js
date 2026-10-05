/**
 * review-probe.js — ад hoc-проверка подозрений ревьюера (роль Reviewer).
 *
 * Не входит в основной набор тестов. Запускается вручную при ревью:
 *   node review-probe.js
 *
 * Проверяет гипотезы о проблемах, найденных при чтении кода.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

// Счётчик POST-запросов живёт во внешней области: функции fetch созданы
// во внешнем realm, поэтому globalThis внутри них — это global Node, а не контекст vm.
let posts = [];

const sandbox = {
  document: {
    getElementById: (id) => els[id] || createEl(),
    createElement: () => createEl()
  },
  window: { scrollTo() {}, confirm: () => true },
  fetch: async (url, options = {}) => {
    if (options && options.method === 'POST') {
      posts.push(options.body);
    }
    return { ok: true, status: 200, text: async () => '[]' };
  },
  setTimeout,
  clearTimeout,
  console
};

const source = fs.readFileSync(path.join(__dirname, 'public', 'script.js'), 'utf8');

const EXPORTS = `
;globalThis.__g = {
  handleCellClick, startGame, evaluateGameState, findBestMove,
  getBoard: () => board.slice(),
  getState: () => ({ isGameActive, currentTurn, isThinking, gameMode, xPlayerName, oPlayerName }),
  setBoard: (c) => { board = c.slice(); },
  setState: (p) => {
    if ('isGameActive' in p) isGameActive = p.isGameActive;
    if ('currentTurn' in p) currentTurn = p.currentTurn;
    if ('isThinking' in p) isThinking = p.isThinking;
  },
  postCount: () => 0
};
`;


vm.createContext(sandbox);
vm.runInContext(source + EXPORTS, sandbox);
const g = sandbox.__g;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('\nПроба ревьюера:');

  // ── Гипотеза 1: повторное сохранение результата ───────────────────────────
  // finishGame() вызывается из evaluateGameState(). Если evaluateGameState()
  // вызвать дважды подряд, результат должен сохраниться ОДИН раз.

  posts = [];
  g.setBoard(['X', 'X', 'X', '', '', '', '', '', '']);
  g.setState({ isGameActive: true, currentTurn: 'X', isThinking: false });
  g.evaluateGameState();
  await sleep(50);
  const firstCount = posts.length;

  g.evaluateGameState();
  await sleep(50);
  const secondCount = posts.length;

  console.log(`  вызовов evaluateGameState: 2`);
  console.log(`  POST после первого: ${firstCount}, после второго: ${secondCount}`);
  if (secondCount > firstCount) {
    console.log('  ⚠️  НАЙДЕНО: результат сохраняется повторно при повторном вызове');
  } else {
    console.log('  ✅ повторного сохранения нет');
  }

  // ── Гипотеза 2: формат played_at и его разбор ────────────────────────────
  // SQLite отдаёт 'YYYY-MM-DD HH:MM:SS' в UTC. Проверяем, что клиент
  // не «сдвигает» время и что невалидная дата не роняет страницу.

  const fmt = vm.runInContext('formatDate', sandbox);
  console.log(`  formatDate('2026-10-05 14:03:21') = ${fmt('2026-10-05 14:03:21')}`);
  console.log(`  formatDate('мусор') = ${fmt('мусор')}`);
  console.log(`  formatDate('') = ${fmt('')}`);

  // ── Гипотеза 3: имя игрока длиной ровно 30 на клиенте ─────────────────────
  // maxlength=30 в HTML, но проверяем и сам код валидации.

  const validate = vm.runInContext('validateName', sandbox);
  els['player-name'].value = 'я'.repeat(30);
  console.log(`  validateName для 30 символов: ${validate()}`);
  els['player-name'].value = 'я'.repeat(31);
  console.log(`  validateName для 31 символа: ${validate()}`);

  // ── Гипотеза 4: имена с невидимыми символами и новой строкой ─────────────
  // trim() в JS не убирает все пробельные символы, которые умеет SQLite trim.

  posts = [];
  g.setBoard(['', '', '', '', '', '', '', '', '']);
  g.setState({ isGameActive: true, currentTurn: 'X', isThinking: false });
  els['player-name'].value = '   \n  ';
  console.log(`  validateName для " \\n " (пробел+перевод строки): ${validate()}`);

  
  // ── Гипотеза 5 (важная): достижим ли двойной POST обычными кликами? ──────
  // Сценарий: игрок кликает быстро подряд, пока компьютер "думает".
  // Проверяем реальный путь: handleCellClick -> evaluateGameState.

  posts = [];
  els['player-name'].value = 'Кликер';

  // Запускаем партию штатно, чтобы xPlayerName был инициализирован
  g.startGame();

  g.setBoard(['', '', '', '', '', '', '', '', '']);
  g.setState({ isGameActive: true, currentTurn: 'X', isThinking: false });

  // Игрок занимает верхнюю строку 0,1,2 — третий клик приносит победу
  g.handleCellClick(0);
  await sleep(600); // ждём ход компьютера
  g.handleCellClick(1);
  await sleep(600);
  g.handleCellClick(2); // победа
  await sleep(300);

  console.log('  состояние партии =', JSON.stringify(g.getState()));
  console.log('  поле после 3 кликов =', JSON.stringify(g.getBoard()));
  console.log(`\n  Победная серия из 3 кликов: POST отправлено ${posts.length} (ожидается 1)`);
  if (posts.length) {
    console.log('  тело POST:', posts[0]);
  }

  // И после победы пробуем кликнуть ещё раз — поле должно быть заблокировано
  const before = posts.length;
  g.handleCellClick(5);
  g.handleCellClick(6);
  await sleep(200);

  console.log(`  Клики после победы: +${posts.length - before} (ожидается 0)`);
  console.log(`  ИТОГ реальный путь: POST=${posts.length} ${posts.length === 1 ? '✅ корректно' : '⚠️  дубликат'}`);
}

main().catch((err) => {
  console.error('Проба упала:', err);
  process.exit(1);
});