// scripts/check.js — 对所有 JS 文件执行语法检查
const { execSync } = require('child_process');
const { readdirSync, statSync } = require('fs');
const path = require('path');

function getJsFiles(dir, exclude = ['node_modules', 'data', 'backups', 'public/bundle.js']) {
  let results = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (exclude.some(e => full.includes(e))) continue;
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results = results.concat(getJsFiles(full, exclude));
    } else if (entry.endsWith('.js')) {
      results.push(full);
    }
  }
  return results;
}

const files = getJsFiles(process.cwd());
let errors = 0;
for (const f of files) {
  try {
    execSync(`node --check "${f}"`, { stdio: 'pipe' });
  } catch (e) {
    console.error(`FAIL: ${f}`);
    errors++;
  }
}
if (errors) {
  console.error(`\n${errors} file(s) failed syntax check`);
  process.exit(1);
} else {
  console.log(`All ${files.length} file(s) passed syntax check`);
}
