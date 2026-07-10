const db = require('better-sqlite3')('data/collab-grid.db');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('Tables:', tables.map(t => t.name).join(', '));
if (tables.some(t => t.name === 'users')) {
  const users = db.prepare('SELECT id, email, display_name, system_role FROM users ORDER BY created_at DESC LIMIT 5').all();
  console.log('\nUsers:');
  for (const u of users) { console.log(' ', u.email, '(', u.display_name, ') sys_role:', u.system_role, 'id:', u.id); }
}
if (tables.some(t => t.name === 'bases')) {
  const bases = db.prepare('SELECT * FROM bases ORDER BY created_at DESC LIMIT 5').all();
  console.log('\nBases:');
  for (const b of bases) { console.log(' ', b.name, 'owner:', b.owner_id, 'id:', b.id); }
}
if (tables.some(t => t.name === 'members')) {
  const members = db.prepare('SELECT * FROM members ORDER BY joined_at DESC LIMIT 10').all();
  console.log('\nMembers:');
  for (const m of members) { console.log(' ', 'base:', m.base_id.slice(0,8), 'user:', m.user_id.slice(0,8), 'role:', m.role); }
}
