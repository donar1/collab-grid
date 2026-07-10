const db = require('better-sqlite3')('data.db');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('Tables:', tables.map(t => t.name).join(', ') || '(none)');
if (tables.some(t => t.name === 'users')) {
  const users = db.prepare('SELECT email, display_name, created_at FROM users ORDER BY created_at DESC LIMIT 5').all();
  console.log('Users:', JSON.stringify(users, null, 2));
}
