const dbAdapter = require('../services/dbAdapter');
const bcrypt = require('bcryptjs');

async function main() {
  await dbAdapter.init();
  try {
    const newHash = bcrypt.hashSync('Admin@123456', 10);
    await dbAdapter.runAsync('UPDATE users SET password_hash = $1 WHERE email = $2', [newHash, 'admin@collabgrid.local']);
    console.log('Password reset OK');
    const user = await dbAdapter.queryOneAsync('SELECT id, email FROM users WHERE email = $1', ['admin@collabgrid.local']);
    console.log('User:', user);
  } catch (e) {
    console.error('Error:', e.message);
  }
  await dbAdapter.close();
}

main();
