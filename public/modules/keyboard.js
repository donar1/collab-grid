(function (global) {
  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function nextCellPosition({ row, col, key, shiftKey = false, rowCount, colCount }) {
    let nextRow = row;
    let nextCol = col;
    if (key === 'ArrowLeft') nextCol--;
    else if (key === 'ArrowRight') nextCol++;
    else if (key === 'ArrowUp') nextRow--;
    else if (key === 'ArrowDown') nextRow++;
    else if (key === 'Tab') nextCol += shiftKey ? -1 : 1;
    else if (key === 'Enter') nextRow += shiftKey ? -1 : 1;
    else return null;
    return {
      row: clamp(nextRow, 0, Math.max(0, rowCount - 1)),
      col: clamp(nextCol, 0, Math.max(0, colCount - 1)),
    };
  }

  const api = { nextCellPosition };
  global.CollabGridKeyboard = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
