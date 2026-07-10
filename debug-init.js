const dbAdapter = require('./services/dbAdapter');

async function test() {
  console.log('[test] dbAdapter.init()...');
  await dbAdapter.init();
  console.log('[test] init done, engine:', dbAdapter.getEngine());

  console.log('[test] testing queryOneAsync...');
  try {
    const r = await dbAdapter.queryOneAsync('SELECT id, system_role FROM users WHERE email=$1', ['admin@collabgrid.local']);
    console.log('[test] queryOneAsync result:', r);
  } catch (e) {
    console.error('[test] queryOneAsync failed:', e.message);
  }

  console.log('[test] testing writeQueryAsync...');
  try {
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('test123', 10);
    await dbAdapter.writeQueryAsync(
      `UPDATE users SET password_hash=$1 WHERE email=$2`,
      [hash, 'admin@collabgrid.local']
    );
    console.log('[test] writeQueryAsync success');
  } catch (e) {
    console.error('[test] writeQueryAsync failed:', e.message);
  }

  console.log('[test] testing matrixStore...');
  try {
    const matrixStore = require('./security/matrixStore');
    await matrixStore.ensureSchemaAsync();
    console.log('[test] matrixStore.ensureSchemaAsync success');
  } catch (e) {
    console.error('[test] matrixStore failed:', e.message, e.stack);
  }

  console.log('[test] testing buildSecurity...');
  try {
    const { buildSecurityAsync } = require('./security/guards');
    const sec = await buildSecurityAsync();
    console.log('[test] buildSecurityAsync success');
  } catch (e) {
    console.error('[test] buildSecurity failed:', e.message);
  }
}

test().catch(e => { console.error('[test] fatal:', e); process.exit(1); });
