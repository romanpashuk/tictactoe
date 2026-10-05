/**
 * css-check.js — проверка целостности public/style.css.
 *
 * Ловит ошибку, из-за которой игра была невидима: незакрытая фигурная скобка
 * в одном правиле «съедала» все последующие (вложенность делала селекторы
 * вроде .board неприменимыми).
 *
 * Проверяет:
 *   1) баланс фигурных скобок
 *   2) наличие ключевых правил верхнего уровня
 *   3) обязательные элементы оформления (тёмная тема, адаптивность)
 *   4) что каждый id из index.html имеет стили или используется по классу
 *
 * Запуск: node css-check.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

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

const css = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8');

console.log('\nПроверка CSS:');

// ── 1. Баланс фигурных скобок ─────────────────────────────────────────────

let depth = 0;
let extraCloseLine = null;
let line = 1;

for (const ch of css) {
  if (ch === '\n') {
    line += 1;
  } else if (ch === '{') {
    depth += 1;
  } else if (ch === '}') {
    depth -= 1;
    if (depth < 0 && extraCloseLine === null) {
      extraCloseLine = line;
    }
  }
}

check('фигурные скобки сбалансированы', depth === 0);
check('нет лишней закрывающей скобки', extraCloseLine === null);

if (extraCloseLine !== null) {
  console.log(`     лишняя "}" на строке ${extraCloseLine}`);
}

// ── 2. Ключевые правила верхнего уровня ───────────────────────────────────

const topLevelRules = [];
const ruleRegex = /^([^\n@{}][^{}\n]*?)\s*\{/gm;
let match;

while ((match = ruleRegex.exec(css)) !== null) {
  topLevelRules.push(match[1].trim());
}

const REQUIRED_RULES = [
  '.board', '.cell', '.turn', '.toast', 'table', '.screen',
  '.btn', '.input', '.result-win', '.result-lose', '.result-draw',
  '.mode-select', '.mode-option'
];

for (const rule of REQUIRED_RULES) {
  check(`правило "${rule}" на верхнем уровне`, topLevelRules.includes(rule));
}

// ── 3. Обязательные элементы оформления ───────────────────────────────────

check('тёмная тема задана (переменная --bg)', css.includes('--bg:'));
check('цвет текста определён (--text)', css.includes('--text:'));
check('адаптивность есть (@media)', /@media\s*\(max-width:\s*480px\)/.test(css));
check('поле 3×3 (grid-template-columns: repeat(3, 1fr))', css.includes('repeat(3, 1fr)'));
check('клетки квадратные (aspect-ratio)', css.includes('aspect-ratio'));
check('нет внешних шрифтов и CDN', !/url\(https?:/.test(css));

// ── 4. Связь с index.html ─────────────────────────────────────────────────

const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

const ELEMENT_CLASSES = [
  { id: 'menu-screen', cls: 'screen' },
  { id: 'game-screen', cls: 'screen' },
  { id: 'start-game', cls: 'btn btn-primary' },
  { id: 'clear-history', cls: 'btn btn-danger' },
  { id: 'player-name', cls: 'input' },
  { id: 'player2-name', cls: 'input' },
  { id: 'mode-ai', cls: 'mode-option' },
  { id: 'mode-duo', cls: 'mode-option' },
  { id: 'turn-indicator', cls: 'turn' },
  { id: 'board', cls: 'board' },
  { id: 'history-table', cls: 'table' }, // стилизован селектором элемента
  { id: 'play-again', cls: 'btn btn-primary' },
  { id: 'toast', cls: 'toast' }
];

for (const { id, cls } of ELEMENT_CLASSES) {
  const inHtml = html.includes(`id="${id}"`);
  // Правило есть либо по классу, либо по имени тега
  const mainClass = cls.split(' ').pop();
  const inCss = topLevelRules.includes(`.${mainClass}`) || topLevelRules.includes(mainClass);

  check(`#${id} есть в разметке и имеет стили (${cls})`, inHtml && inCss);
}

console.log(`\nИтог: успешно ${passed}, провалено ${failed}`);
process.exit(failed === 0 ? 0 : 1);