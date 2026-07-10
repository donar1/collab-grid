// tests/unit/formulaService.test.js
// P2-1: 公式引擎纯单元测试（零依赖，无需数据库）
// 覆盖：四则运算、括号、字段引用、除零保护、浮点精度、非法输入

const { evaluateFormula, evaluateTextFormula, tokenize, parseAndEval } = require('../../services/formulaService');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { passed++; }
  else { failed++; console.error(`  FAIL: ${label}`); }
}

function assertEqual(actual, expected, label) {
  if (actual === expected) { passed++; }
  else { failed++; console.error(`  FAIL: ${label} — expected "${expected}", got "${actual}"`); }
}

// ---- tokenize ----
assertEqual(JSON.stringify(tokenize('3+5')), '[{"type":"num","value":"3"},{"type":"op","value":"+"},{"type":"num","value":"5"}]', 'tokenize: 3+5');
assertEqual(JSON.stringify(tokenize('{数量} * {单价}')), '[{"type":"ref","name":"数量"},{"type":"op","value":"*"},{"type":"ref","name":"单价"}]', 'tokenize: {数量} * {单价}');
assert(tokenize('3+!') === null, 'tokenize: invalid char returns null');
assert(tokenize('{abc') === null, 'tokenize: unclosed ref returns null');
assertEqual(JSON.stringify(tokenize('(1+2)*3')), '[{"type":"op","value":"("},{"type":"num","value":"1"},{"type":"op","value":"+"},{"type":"num","value":"2"},{"type":"op","value":")"},{"type":"op","value":"*"},{"type":"num","value":"3"}]', 'tokenize: (1+2)*3');

// ---- parseAndEval ----
const identity = n => n;
function numRef(name) { return { '数量': 10, '单价': 5, '折扣': 0.8, '空': '0' }[name] || 0; }

assertEqual(parseAndEval(tokenize('3+5'), identity), 8, 'parseAndEval: 3+5');
assertEqual(parseAndEval(tokenize('10-3'), identity), 7, 'parseAndEval: 10-3');
assertEqual(parseAndEval(tokenize('4*5'), identity), 20, 'parseAndEval: 4*5');
assertEqual(parseAndEval(tokenize('10/2'), identity), 5, 'parseAndEval: 10/2');
assertEqual(parseAndEval(tokenize('1+2*3'), identity), 7, 'parseAndEval: 1+2*3 (precedence)');
assertEqual(parseAndEval(tokenize('(1+2)*3'), identity), 9, 'parseAndEval: (1+2)*3 (parens)');
assert(Number.isNaN(parseAndEval(tokenize('3/0'), identity)), 'parseAndEval: 3/0 = NaN');

// ---- evaluateFormula ----
assertEqual(evaluateFormula('{数量} * {单价}', name => numRef(name)), '50', 'evaluateFormula: {数量}*{单价}=50');
assertEqual(evaluateFormula('{数量} * {单价} * {折扣}', name => numRef(name)), '40', 'evaluateFormula: with discount');
assertEqual(evaluateFormula('', null), '', 'evaluateFormula: empty string');
assertEqual(evaluateFormula('abc', null), '', 'evaluateFormula: no refs = invalid');
assertEqual(evaluateFormula('{不存在}', name => 0), '0', 'evaluateFormula: missing ref returns 0');
assertEqual(evaluateFormula('{数量} + {空}', name => numRef(name)), '10', 'evaluateFormula: {空}=0');

// ---- evaluateTextFormula ----
assertEqual(evaluateTextFormula('订单号：{订单号}', name => ({ '订单号': 'ORD001' })[name] || ''), '订单号：ORD001', 'evaluateTextFormula: basic');
assertEqual(evaluateTextFormula('客户：{客户}', name => ({ '客户': '张三' })[name] || ''), '客户：张三', 'evaluateTextFormula: Chinese text');
assertEqual(evaluateTextFormula('', null), '', 'evaluateTextFormula: empty');
assertEqual(evaluateTextFormula('无变量', null), '无变量', 'evaluateTextFormula: no refs');

// ---- report ----
const total = passed + failed;
console.log(`\n formulaService.test.js: ${total} tests, ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);