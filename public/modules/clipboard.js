(function (global) {
  function selectionRange(sel) {
    if (!sel) return null;
    const r1 = Math.min(sel.anchor.row, sel.focus.row);
    const r2 = Math.max(sel.anchor.row, sel.focus.row);
    const c1 = Math.min(sel.anchor.col, sel.focus.col);
    const c2 = Math.max(sel.anchor.col, sel.focus.col);
    return { r1, r2, c1, c2 };
  }

  function parseClipboardTable(text) {
    return String(text || '')
      .replace(/\r\n/g, '\n')
      .split('\n')
      .filter(line => line.length)
      .map(line => line.split('\t').map(cell => cell.trim()));
  }

  function sanitizeCellForTsv(value) {
    return String(value == null ? '' : value).replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
  }

  const api = { selectionRange, parseClipboardTable, sanitizeCellForTsv };
  global.CollabGridClipboard = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
