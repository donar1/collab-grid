// scripts/build.js — 前端构建脚本（esbuild）
const esbuild = require('esbuild');
const path = require('path');

const isDev = process.env.NODE_ENV !== 'production';
const isWatch = process.argv.includes('--watch');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DIST_DIR = path.join(PUBLIC_DIR, 'dist');

async function build() {
  // 清理 dist 目录
  const fs = require('fs');
  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true });
  }
  fs.mkdirSync(DIST_DIR, { recursive: true });

  const result = await esbuild.build({
    entryPoints: [path.join(PUBLIC_DIR, 'app.js')],
    bundle: true,
    outdir: DIST_DIR,
    entryNames: 'app.[hash]',
    chunkNames: 'chunks/[name].[hash]',
    format: 'esm',
    target: ['es2020'],
    minify: !isDev,
    sourcemap: isDev,
    treeShaking: true,
    splitting: true,          // 启用代码分割
    metafile: true,           // 生成分析文件
    define: {
      'process.env.NODE_ENV': isDev ? '"development"' : '"production"',
    },
    logLevel: 'info',
  });

  // 输出构建信息
  if (result.metafile) {
    const inputs = Object.keys(result.metafile.inputs);
    const outputs = Object.keys(result.metafile.outputs);
    console.log(`[build] ${inputs.length} inputs -> ${outputs.length} outputs`);
    for (const [file, info] of Object.entries(result.metafile.outputs)) {
      const size = (info.bytes / 1024).toFixed(1);
      console.log(`  ${path.basename(file)}: ${size} KB`);
    }
    // 保存 metafile 用于分析
    fs.writeFileSync(path.join(DIST_DIR, 'meta.json'), JSON.stringify(result.metafile, null, 2));
  }

  // 复制 CSS 到 dist（CSS 不需要打包，直接复制）
  const cssFiles = ['styles.css'];
  for (const f of cssFiles) {
    const src = path.join(PUBLIC_DIR, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(DIST_DIR, f));
    }
  }
  // 复制 modules/css 目录
  const cssDir = path.join(PUBLIC_DIR, 'modules', 'css');
  const distCssDir = path.join(DIST_DIR, 'modules', 'css');
  if (fs.existsSync(cssDir)) {
    fs.mkdirSync(distCssDir, { recursive: true });
    for (const file of fs.readdirSync(cssDir)) {
      fs.copyFileSync(path.join(cssDir, file), path.join(distCssDir, file));
    }
  }

  return result;
}

if (isWatch) {
  const ctx = esbuild.context({
    entryPoints: [path.join(PUBLIC_DIR, 'app.js')],
    bundle: true,
    outdir: DIST_DIR,
    entryNames: 'app.[hash]',
    chunkNames: 'chunks/[name].[hash]',
    format: 'esm',
    target: ['es2020'],
    minify: false,
    sourcemap: true,
    treeShaking: true,
    splitting: true,
    metafile: true,
    define: { 'process.env.NODE_ENV': '"development"' },
    logLevel: 'info',
  });
  ctx.watch().then(() => console.log('[build] Watching for changes...'));
} else {
  build().catch(err => {
    console.error('[build] Failed:', err.message);
    process.exit(1);
  });
}
