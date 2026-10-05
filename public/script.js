/**
 * script.js — клиентская логика: состояние игры, правила, ИИ, работа с API.
 *
 * Безопасность: пользовательские данные (имя игрока) выводятся ТОЛЬКО через
 * textContent / createElement — innerHTML не используется, поэтому XSS невозможен.
 */

'use strict';

// ── Константы игры ────────────────────────────────────────────────────────

const PLAYER_MARK = 'X'; // Игрок всегда ходит крестиками
const COMPUTER_MARK = 'O'; // Компьютер — ноликами
const NAME_MAX_LENGTH = 30; // Максимальная длина имени
const AI_DELAY_MS = 400; // Задержка хода компьютера (визуальный отклик)
const TOAST_MS = 3000; // Время показа уведомления

// Выигрышные комбинации: 8 троек индексов поля 0..8
const WINNING_LINES = [
  [0, 1, 2], // верхняя строка
  [3, 4, 5], // средняя строка
  [6, 7, 8], // нижняя строка
  [0, 3, 6], // левый столбец
  [1, 4, 7], // средний столбец
  [2, 5, 8], // правый столбец
  [0, 4, 8], // главная диагональ
  [2, 4, 6] // побочная диагональ
];

// ── Состояние ─────────────────────────────────────────────────────────────

/** Текущая доска: массив из 9 элементов ('' | 'X' | 'O') */
let board = [];

/** Имя игрока текущей партии */
let playerName = '';

/** Кто сейчас ходит: 'X' (игрок) или 'O' (компьютер) */
let currentTurn = PLAYER_MARK;

/** Идёт ли партия (false — игра окончена или ещё не начата) */
let isGameActive = false;

/** Заблокировано ли поле (ход компьютера уже запланирован) */
let isThinking = false;

// Таймер хода компьютера и таймер уведомления
let aiTimer = null;
let toastTimer = null;

// ── Ссылки на элементы DOM ────────────────────────────────────────────────

const menuScreen = document.getElementById('menu-screen');
const gameScreen = document.getElementById('game-screen');
const nameInput = document.getElementById('player-name');
const nameError = document.getElementById('name-error');
const startGameBtn = document.getElementById('start-game');
const clearHistoryBtn = document.getElementById('clear-history');
const historyTable = document.getElementById('history-table');
const historyBody = document.getElementById('history-body');
const historyEmpty = document.getElementById('history-empty');
const gamePlayerLabel = document.getElementById('game-player');
const turnIndicator = document.getElementById('turn-indicator');
const boardEl = document.getElementById('board');
const playAgainBtn = document.getElementById('play-again');
const toastEl = document.getElementById('toast');

// ── Уведомления ───────────────────────────────────────────────────────────

/**
 * Показать уведомление внизу экрана.
 * @param {string} message Текст уведомления.
 * @param {'success'|'error'} type Тип (цвет).
 */
function showToast(message, type = 'success') {
  // Снимаем предыдущий таймер, чтобы уведомления не наезжали друг на друга
  if (toastTimer) {
    clearTimeout(toastTimer);
  }

  toastEl.textContent = message;
  toastEl.className = `toast toast-${type}`;
  toastEl.hidden = false;

  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, TOAST_MS);
}

// ── Работа с API ──────────────────────────────────────────────────────────

/**
 * Выполнить fetch-запрос к API с обработкой ошибок сети и кодов ответа.
 * @param {string} url Адрес.
 * @param {RequestInit} options Опции запроса.
 * @returns {Promise<any>} Распарсенный JSON.
 * @throws {Error} Сообщение с текстом ошибки для показа пользователю.
 */
async function apiRequest(url, options = {}) {
  let response;

  try {
    response = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
  } catch (_) {
    // Сетевая ошибка: сервер недоступен
    throw new Error('Нет связи с сервером. Проверьте, что он запущен.');
  }

  // Сначала читаем текст: так обработаем и JSON, и не-JSON ответы
  const rawText = await response.text();

  let data = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch (_) {
    throw new Error('Сервер вернул некорректный ответ.');
  }

  if (!response.ok) {
    // Берём сообщение сервера, если оно есть
    throw new Error((data && data.error) || `Ошибка сервера (${response.status})`);
  }

  return data;
}

/**
 * Загрузить историю игр и отрисовать её в таблице.
 */
async function loadHistory() {
  try {
    const games = await apiRequest('/api/games');

    // Полностью очищаем tbody — без innerHTML (защита от XSS)
    historyBody.replaceChildren();

    if (!Array.isArray(games) || games.length === 0) {
      historyTable.hidden = true;
      historyEmpty.hidden = false;
      return;
    }

    for (const game of games) {
      const row = document.createElement('tr');

      // Ячейка: имя игрока (textContent — безопасно, это текст, а не HTML)
      const nameCell = document.createElement('td');
      nameCell.textContent = game.player_name;
      row.appendChild(nameCell);

      // Ячейка: результат (человекочитаемый текст + цвет)
      const resultCell = document.createElement('td');
      const resultLabel = { win: 'Победа', lose: 'Поражение', draw: 'Ничья' };
      resultCell.textContent = resultLabel[game.result] || game.result;
      resultCell.className = `result-${game.result}`;
      row.appendChild(resultCell);

      // Ячейка: дата в удобном виде
      const dateCell = document.createElement('td');
      dateCell.textContent = formatDate(game.played_at);
      row.appendChild(dateCell);

      historyBody.appendChild(row);
    }

    historyTable.hidden = false;
    historyEmpty.hidden = true;
  } catch (err) {
    showToast(err.message, 'error');
    historyTable.hidden = true;
    historyEmpty.hidden = false;
  }
}

/**
 * Преобразовать дату SQLite ("YYYY-MM-DD HH:MM:SS") в локальный вид.
 * @param {string} value Дата из БД.
 * @returns {string} Дата в формате ДД.ММ.ГГГГ ЧЧ:ММ.
 */
function formatDate(value) {
  // SQLite отдаёт дату в UTC; без 'Z' браузер интерпретирует её как локальное
  // время, поэтому явно указываем часовой пояс UTC
  const date = new Date(`${value}Z`);

  if (Number.isNaN(date.getTime())) {
    return value; // Если формат неожиданный — показываем как есть
  }

  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

// ── Валидация имени на клиенте (только UX; сервер валидирует повторно) ─────

/**
 * Проверить имя игрока и показать ошибку при необходимости.
 * @returns {boolean} true, если имя корректно.
 */
function validateName() {
  const value = nameInput.value.trim();

  if (value.length === 0) {
    showNameError('Введите имя игрока');
    return false;
  }

  if (value.length > NAME_MAX_LENGTH) {
    showNameError(`Имя игрока: не более ${NAME_MAX_LENGTH} символов`);
    return false;
  }

  hideNameError();
  return true;
}

/**
 * Показать ошибку под полем ввода.
 * @param {string} message Текст ошибки.
 */
function showNameError(message) {
  nameError.textContent = message;
  nameError.hidden = false;
  nameInput.classList.add('input-error');
}

/** Скрыть ошибку под полем ввода. */
function hideNameError() {
  nameError.hidden = true;
  nameInput.classList.remove('input-error');
}
// ── Логика игры ───────────────────────────────────────────────────────────

/**
 * Создать поле 3×3 (9 клеток) один раз при загрузке страницы.
 */
function buildBoard() {
  boardEl.replaceChildren();

  for (let i = 0; i < 9; i += 1) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cell';
    cell.dataset.index = String(i);
    cell.setAttribute('aria-label', `Клетка ${i + 1}`);
    cell.addEventListener('click', () => handleCellClick(i));
    boardEl.appendChild(cell);
  }
}

/**
 * Обработчик клика по клетке.
 * @param {number} index Индекс клетки 0..8.
 */
function handleCellClick(index) {
  // Игра окончена — поле заблокировано
  if (!isGameActive) {
    return;
  }

  // Идёт ход компьютера — блокируем поле
  if (isThinking) {
    return;
  }

  // Сейчас не ход игрока — игнорируем
  if (currentTurn !== PLAYER_MARK) {
    return;
  }

  // Клетка уже занята — игнорируем
  if (board[index] !== '') {
    return;
  }

  makeMove(index, PLAYER_MARK);

  // После хода проверяем, не закончилась ли партия
  if (evaluateGameState()) {
    return;
  }

  // Ход переходит к компьютеру: блокируем поле на время "раздумья"
  currentTurn = COMPUTER_MARK;
  isThinking = true;
  updateTurnIndicator();
  lockBoard(true);

  aiTimer = setTimeout(computerMove, AI_DELAY_MS);
}

/**
 * Выполнить ход: записать знак в поле и обновить отображение.
 * @param {number} index Индекс клетки.
 * @param {string} mark 'X' или 'O'.
 */
function makeMove(index, mark) {
  board[index] = mark;
  renderBoard();
}

/**
 * Ход компьютера: выбирает клетку по приоритетам и делает ход.
 */
function computerMove() {
  // Страховка: если партия уже окончена, ход не делаем
  if (!isGameActive) {
    return;
  }

  const index = findBestMove();

  if (index !== -1) {
    makeMove(index, COMPUTER_MARK);
  }

  // Снимаем блокировку и возвращаем ход игроку
  isThinking = false;
  currentTurn = PLAYER_MARK;
  lockBoard(false);

  // Проверяем результат после хода компьютера
  if (evaluateGameState()) {
    return;
  }

  // Партия продолжается — показываем, что снова ход игрока
  updateTurnIndicator();
}

/**
 * Простой ИИ компьютера по приоритету:
 * 1) выиграть самому, 2) блокировать победу игрока, 3) центр, 4) углы, 5) остальное.
 *
 * @returns {number} Индекс клетки или -1, если ходов нет.
 */
function findBestMove() {
  // Приоритет 1: немедленная победа
  let move = findWinningMove(COMPUTER_MARK);
  if (move !== -1) {
    return move;
  }

  // Приоритет 2: блокировка победы игрока
  move = findWinningMove(PLAYER_MARK);
  if (move !== -1) {
    return move;
  }

  // Приоритет 3: центр
  if (board[4] === '') {
    return 4;
  }

  // Приоритет 4: углы
  for (const index of [0, 2, 6, 8]) {
    if (board[index] === '') {
      return index;
    }
  }

  // Приоритет 5: оставшиеся клетки
  for (let i = 0; i < 9; i += 1) {
    if (board[i] === '') {
      return i;
    }
  }

  // Поле заполнено — ходов нет
  return -1;
}

/**
 * Найти клетку, выигрывающую партию для указанного знака.
 * @param {string} mark Знак игрока.
 * @returns {number} Индекс клетки или -1.
 */
function findWinningMove(mark) {
  for (const [a, b, c] of WINNING_LINES) {
    // Проверяем случаи: две клетки заняты нужным знаком, третья пуста
    if (board[a] === mark && board[b] === mark && board[c] === '') {
      return c;
    }
    if (board[a] === mark && board[c] === mark && board[b] === '') {
      return b;
    }
    if (board[b] === mark && board[c] === mark && board[a] === '') {
      return a;
    }
  }
  return -1;
}

/**
 * Определить состояние партии и при необходимости завершить её.
 *
 * @returns {boolean} true, если партия окончена.
 */
function evaluateGameState() {
  // 1. Сначала проверяем победу (на последнем ходу победа приоритетнее ничьей)
  const winningLine = getWinningLine();
  if (winningLine) {
    finishGame(PLAYER_MARK === board[winningLine[0]] ? 'win' : 'lose', winningLine);
    return true;
  }

  // 2. Иначе проверяем ничью — поле заполнено, победителя нет
  if (board.every((cell) => cell !== '')) {
    finishGame('draw', null);
    return true;
  }

  // 3. Партия продолжается
  return false;
}

/**
 * Найти выигрышную комбинацию на поле.
 * @returns {Array<number>|null} Массив индексов или null.
 */
function getWinningLine() {
  for (const line of WINNING_LINES) {
    const [a, b, c] = line;
    if (board[a] !== '' && board[a] === board[b] && board[b] === board[c]) {
      return line;
    }
  }
  return null;
}

/**
 * Завершить партию: показать итог, сохранить результат, показать кнопку.
 * @param {'win'|'lose'|'draw'} result Результат с точки зрения игрока.
 * @param {Array<number>|null} winningLine Индексы выигрышных клеток.
 */
function finishGame(result, winningLine) {
  isGameActive = false;

  // Отменяем запланированный ход компьютера, если он ещё в очереди
  if (aiTimer) {
    clearTimeout(aiTimer);
    aiTimer = null;
  }

  // Разблокируем поле и подсвечиваем выигрышные клетки
  lockBoard(false);
  if (winningLine) {
    for (const index of winningLine) {
      boardEl.children[index].classList.add('winner');
    }
  }

  // Показываем итог партии
  const messages = {
    win: 'Вы победили! 🎉',
    lose: 'Вы проиграли 😔',
    draw: 'Ничья 🤝'
  };
  const classes = {
    win: 'turn turn-win',
    lose: 'turn turn-lose',
    draw: 'turn turn-draw'
  };

  turnIndicator.textContent = messages[result];
  turnIndicator.className = classes[result];

  playAgainBtn.hidden = false;

  // Автосохранение результата партии
  saveGameResult(result);
}

/**
 * Отправить результат партии на сервер.
 * @param {'win'|'lose'|'draw'} result Результат.
 */
async function saveGameResult(result) {
  try {
    await apiRequest('/api/games', {
      method: 'POST',
      body: JSON.stringify({ player_name: playerName, result })
    });
    showToast('Результат сохранён');
  } catch (err) {
    showToast(`Не удалось сохранить результат: ${err.message}`, 'error');
  }
}

// ── Отрисовка ─────────────────────────────────────────────────────────────

/**
 * Отрисовать поле 3×3 по текущему состоянию board.
 */
function renderBoard() {
  for (let i = 0; i < 9; i += 1) {
    boardEl.children[i].textContent = board[i];
  }
}

/**
 * Заблокировать или разблокировать клетки поля.
 * @param {boolean} locked true — заблокировать.
 */
function lockBoard(locked) {
  for (const cell of boardEl.children) {
    cell.disabled = locked || !isGameActive;
  }
}

/**
 * Обновить индикатор текущего хода.
 */
function updateTurnIndicator() {
  turnIndicator.className = 'turn';
  turnIndicator.textContent =
    currentTurn === PLAYER_MARK ? 'Ваш ход (X)' : 'Ход компьютера (O)…';
}

// ── Управление экранами ───────────────────────────────────────────────────

/** Переключиться на экран игры. */
function showGameScreen() {
  menuScreen.hidden = true;
  gameScreen.hidden = false;
  window.scrollTo(0, 0);
}

/** Вернуться в меню и обновить историю. */
function showMenuScreen() {
  gameScreen.hidden = true;
  menuScreen.hidden = false;
  window.scrollTo(0, 0);
  loadHistory();
}

/**
 * Запустить новую партию.
 */
function startGame() {
  if (!validateName()) {
    nameInput.focus();
    return;
  }

  playerName = nameInput.value.trim();
  board = Array(9).fill('');
  currentTurn = PLAYER_MARK;
  isGameActive = true;
  isThinking = false;

  // Сбрасываем клетки: очищаем текст, классы и атрибут disabled
  for (const cell of boardEl.children) {
    cell.textContent = '';
    cell.className = 'cell';
    cell.disabled = false;
  }

  gamePlayerLabel.textContent = playerName; // textContent — безопасно для XSS
  updateTurnIndicator();
  playAgainBtn.hidden = true;

  showGameScreen();
}

/**
 * Очистить историю игр (с подтверждением).
 */
async function clearHistory() {
  const confirmed = window.confirm(
    'Удалить всю историю игр? Действие необратимо.'
  );
  if (!confirmed) {
    return;
  }

  clearHistoryBtn.disabled = true;

  try {
    const result = await apiRequest('/api/games', { method: 'DELETE' });
    showToast(`История очищена (удалено записей: ${result.deleted})`);
    await loadHistory();
  } catch (err) {
    showToast(`Не удалось очистить историю: ${err.message}`, 'error');
  } finally {
    clearHistoryBtn.disabled = false;
  }
}

// ── Инициализация ─────────────────────────────────────────────────────────

// Обработчики кнопок
startGameBtn.addEventListener('click', startGame);
clearHistoryBtn.addEventListener('click', clearHistory);
playAgainBtn.addEventListener('click', showMenuScreen);

// Валидация по мере ввода — убираем ошибку, как только имя исправлено
nameInput.addEventListener('input', () => {
  if (!nameError.hidden) {
    hideNameError();
  }
});

// Enter в поле имени запускает игру
nameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    startGame();
  }
});

// При загрузке: строим поле и подгружаем историю
buildBoard();
loadHistory();