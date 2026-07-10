const BASE = 'http://localhost:3001';
async function call(method, path, body, token) {
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
  const { status, data } = await call('POST', '/api/login', { email: 'admin@test.local', password: 'Admin123456!@' });
  console.log('Login:', status, data.error || data.token?.slice(0, 20));
  const token = data.token;

  const b = await call('GET', '/api/bases', undefined, token);
  console.log('Bases:', b.status, JSON.stringify(b.data.bases?.map(x => x.id?.slice(0,8)) || b.data.error));

  const baseId = b.data.bases?.[0]?.id;
  if (baseId) {
    const d = await call('GET', '/api/bases/' + baseId, undefined, token);
    console.log('Detail:', d.status, d.data.error || ('tables=' + (d.data.tables?.length || 0)));
  }
})();
