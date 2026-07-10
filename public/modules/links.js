(function (global) {
  function pickerTitle(field) {
    return field?.options?.multiple ? '关联记录（多选）' : '关联记录（单选）';
  }

  function pickerDescription(targetName, multiple) {
    if (multiple) return `从「${targetName || '目标表已不存在'}」中选择记录。再次点击已选中的记录可取消关联。`;
    return `从「${targetName || '目标表已不存在'}」中选择一条记录。选择新记录会自动替换旧关联。`;
  }

  function summaryText(count, multiple) {
    if (!count) return '未关联';
    return multiple ? `已关联 ${count} 条` : '已关联 1 条';
  }

  const api = { pickerTitle, pickerDescription, summaryText };
  global.CollabGridLinks = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
