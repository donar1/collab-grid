// services/formulaService.js
// P0-2: 手写递归下降解析器，替代 Function() 构造器
// 支持：四则运算 (+ - * /)、括号、字段引用 {字段名}
// 安全：无代码执行风险，除零保护，浮点精度控制

function tokenize(expression) {
  const tokens = [];
  let i = 0;
  while (i < expression.length) {
    const ch = expression[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '{' ) {
      let j = i + 1;
      while (j < expression.length && expression[j] !== '}') j++;
      if (j >= expression.length) return null; // unclosed ref
      tokens.push({ type: 'ref', name: expression.slice(i + 1, j).trim() });
      i = j + 1;
      continue;
    }
    if (/[\d.]/.test(ch)) {
      let j = i;
      while (j < expression.length && /[\d.]/.test(expression[j])) j++;
      tokens.push({ type: 'num', value: expression.slice(i, j) });
      i = j;
      continue;
    }
    if ('+-*/()'.includes(ch)) {
      tokens.push({ type: 'op', value: ch });
      i++;
      continue;
    }
    return null; // invalid char
  }
  return tokens;
}

const MAX_DEPTH = 10;

function parseAndEval(tokens, resolveRef, depth = 0) {
  if (depth > MAX_DEPTH) return NaN;
  let pos = 0;
  const visitedRefs = new Set();

  function peek() { return tokens[pos]; }
  function consume() { return tokens[pos++]; }

  function parseExpression() { return parseAddSub(); }

  function parseAddSub() {
    let left = parseMulDiv();
    while (pos < tokens.length) {
      const t = peek();
      if (t.type === 'op' && (t.value === '+' || t.value === '-')) {
        consume();
        const right = parseMulDiv();
        left = t.value === '+' ? left + right : left - right;
      } else break;
    }
    return left;
  }

  function parseMulDiv() {
    let left = parsePrimary();
    while (pos < tokens.length) {
      const t = peek();
      if (t.type === 'op' && (t.value === '*' || t.value === '/')) {
        consume();
        const right = parsePrimary();
        if (t.value === '*') {
          left = left * right;
        } else {
          if (right === 0) return NaN;
          left = left / right;
        }
      } else break;
    }
    return left;
  }

  function parsePrimary() {
    const t = peek();
    if (!t) return NaN;
    if (t.type === 'num') {
      consume();
      const n = Number(t.value);
      return Number.isFinite(n) ? n : NaN;
    }
    if (t.type === 'ref') {
      consume();
      if (visitedRefs.has(t.name)) return NaN; // circular reference
      visitedRefs.add(t.name);
      const v = resolveRef(t.name);
      visitedRefs.delete(t.name);
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    }
    if (t.type === 'op' && t.value === '(') {
      consume();
      const val = parseExpression();
      const close = peek();
      if (close && close.type === 'op' && close.value === ')') consume();
      return val;
    }
    return NaN;
  }

  const result = parseExpression();
  if (pos < tokens.length) return NaN; // trailing garbage
  return result;
}

/**
 * 计算公式值
 * @param {string} expression - 如 '{数量} * {单价}'
 * @param {Function} resolveRef - (name) => value，字段名到值的映射
 * @returns {string} 计算结果字符串，失败返回 ''
 */
function evaluateFormula(expression, resolveRef) {
  if (!expression || typeof expression !== 'string') return '';
  const tokens = tokenize(expression);
  if (!tokens) return '';
  const result = parseAndEval(tokens, resolveRef);
  if (!Number.isFinite(result)) return '';
  // 四舍五入到 4 位小数，消除浮点误差
  return String(Math.round(result * 10000) / 10000);
}

/**
 * 计算文本公式值
 * @param {string} expression - 如 '订单号：{订单号}，客户：{客户}'
 * @param {Function} resolveRef - (name) => value
 * @returns {string}
 */
function evaluateTextFormula(expression, resolveRef) {
  if (!expression || typeof expression !== 'string') return '';
  return expression.replace(/\{([^}]+)\}/g, (_, name) => {
    const val = resolveRef(String(name).trim());
    return val == null ? '' : String(val);
  }).replace(/\s+/g, ' ').trim();
}

async function evaluateFormulaAsync(...args) {
  return evaluateFormula(...args);
}
async function evaluateTextFormulaAsync(...args) {
  return evaluateTextFormula(...args);
}

module.exports = { evaluateFormula, evaluateFormulaAsync, evaluateTextFormula, evaluateTextFormulaAsync, tokenize, parseAndEval };
