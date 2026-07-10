const fs = require('fs');
const path = require('path');
const root = process.argv[2] || '.';

function walk(d) {
  let r = [];
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    const s = fs.statSync(p);
    if (s.isDirectory() && f !== 'node_modules' && f !== 'public' && f !== '.git') {
      r = r.concat(walk(p));
    } else if (f.endsWith('.js')) {
      r.push(p);
    }
  }
  return r;
}

const files = walk(root);
const pattern = process.argv[3];
let found = 0;
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(pattern)) {
      found++;
      console.log(path.relative(root, f) + ':' + (i + 1) + ': ' + lines[i].trim());
    }
  }
}
console.log('---Total "' + pattern + '" occurrences: ' + found);
