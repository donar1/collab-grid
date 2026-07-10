const assert = require('assert');

const clipboard = require('../public/modules/clipboard');
const keyboard = require('../public/modules/keyboard');
const fields = require('../public/modules/fields');
const links = require('../public/modules/links');

function run() {
  assert.deepStrictEqual(
    clipboard.parseClipboardTable('A\tB\r\nC\tD\n'),
    [['A', 'B'], ['C', 'D']],
    'TSV 解析应保留二维结构'
  );
  assert.strictEqual(clipboard.sanitizeCellForTsv('A\tB\nC'), 'A B C', '复制为 TSV 前应清理制表符和换行');
  assert.deepStrictEqual(
    clipboard.selectionRange({ anchor: { row: 3, col: 4 }, focus: { row: 1, col: 2 } }),
    { r1: 1, r2: 3, c1: 2, c2: 4 },
    '选区应归一化为左上到右下'
  );

  assert.deepStrictEqual(
    keyboard.nextCellPosition({ row: 0, col: 0, key: 'ArrowLeft', rowCount: 3, colCount: 3 }),
    { row: 0, col: 0 },
    '方向键到边界时应停在边界'
  );
  assert.deepStrictEqual(
    keyboard.nextCellPosition({ row: 1, col: 1, key: 'Tab', rowCount: 3, colCount: 3 }),
    { row: 1, col: 2 },
    'Tab 应同行右移'
  );
  assert.deepStrictEqual(
    keyboard.nextCellPosition({ row: 1, col: 1, key: 'Enter', shiftKey: true, rowCount: 3, colCount: 3 }),
    { row: 0, col: 1 },
    'Shift+Enter 应同列上移'
  );

  assert.deepStrictEqual(
    fields.normalizeSelectOption({ label: ' 进行中 ', color: '#3b82f6' }),
    { label: '进行中', color: '#3b82f6' },
    '单选项应裁剪名称并保留合法颜色'
  );
  assert.deepStrictEqual(
    fields.normalizeSelectOptions([{ label: 'A', color: '#111111' }, { label: 'A', color: '#222222' }, 'B']).map(x => x.label),
    ['A', 'B'],
    '单选项列表应去重'
  );
  assert.strictEqual(fields.linkAllowsMultiple({ options: { multiple: true } }), true, '多选关联应由 options.multiple 控制');
  assert.strictEqual(links.summaryText(2, true), '已关联 2 条', '多选关联摘要应显示数量');
  assert.strictEqual(links.summaryText(2, false), '已关联 1 条', '单选关联摘要应保持单条语义');

  console.log('frontend logic tests passed');
}

run();
