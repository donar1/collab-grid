const BASE = 'http://localhost:3001';
async function callRaw(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {}; try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text }; }
  return { status: res.status, data };
}

(async () => {
  const login = await callRaw('POST', '/api/login', { email: 'admin@test.local', password: 'Admin123456!@' });
  const token = login.data.token;

  const bases = await callRaw('GET', '/api/bases', undefined, token);
  const baseId = bases.data.bases[0].id;

  const detail = await callRaw('GET', '/api/bases/' + baseId, undefined, token);
  console.log('Tables:', detail.data.tables?.map(t => ({ id: t.id, name: t.name })));

  // Try page API for each table
  for (const t of detail.data.tables || []) {
    const page = await callRaw('GET', `/api/tables/${t.id}/page?offset=0&limit=5`, undefined, token);
    console.log(`Page(${t.name}): ${page.status} records=${page.data.records?.length || 0}`);
  }
})();
