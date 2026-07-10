(function (global) {
  function normalizeSelectOption(opt) {
    if (typeof opt === 'object' && opt !== null) {
      const label = String(opt.label || '').trim();
      return { label, color: /^#[0-9a-fA-F]{6}$/.test(opt.color || '') ? opt.color : '#64748b' };
    }
    return { label: String(opt || '').trim(), color: '#64748b' };
  }

  function normalizeSelectOptions(values) {
    const seen = new Set();
    const result = [];
    for (const raw of values || []) {
      const opt = normalizeSelectOption(raw);
      if (!opt.label || seen.has(opt.label)) continue;
      seen.add(opt.label);
      result.push(opt);
    }
    return result;
  }

  function linkAllowsMultiple(field) {
    return !!field?.options?.multiple;
  }

  function normalizeLinkOptions(options) {
    return {
      tableId: String(options?.tableId || ''),
      displayFieldId: String(options?.displayFieldId || ''),
      multiple: !!options?.multiple,
    };
  }

  const api = { normalizeSelectOption, normalizeSelectOptions, linkAllowsMultiple, normalizeLinkOptions };
  global.CollabGridFields = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
