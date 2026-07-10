// electron/main.js — Electron 主进程
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const { spawn, execSync } = require('child_process');

let mainWindow = null;
let serverProcess = null;

function startServer() {
  return new Promise((resolve, reject) => {
    // 使用系统 node 启动 server.js（避免 Electron Node 的原生模块版本不兼容问题）
    // 先通过 where/which 找到系统 Node 的完整路径
    let nodeBin;
    try {
      const whereCmd = process.platform === 'win32' ? 'where node' : 'which node';
      const result = execSync(whereCmd, { encoding: 'utf-8' }).trim().split('\n')[0];
      nodeBin = result;
    } catch {
      nodeBin = process.platform === 'win32' ? 'node.exe' : 'node';
    }
    console.log(`[Electron] Using node: ${nodeBin}`);
    const serverPath = path.join(__dirname, '..', 'server.js');
    const cmd = `"${nodeBin}" "${serverPath}"`;
    serverProcess = spawn(cmd, [], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        PORT: '0',
        NODE_ENV: 'electron',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });

    let output = '';
    serverProcess.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      console.log(`[server] ${text.trim()}`);
      // 从日志中提取端口号
      const match = text.match(/COLLABGRID_SERVER_PORT=(\d{4,5})/) || text.match(/Server started.*port.*?(\d{4,5})/i);
      if (match) {
        const port = parseInt(match[1], 10);
        resolve(port);
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error(`[server:err] ${data.toString().trim()}`);
    });

    serverProcess.on('error', (err) => {
      console.error('[server] process error:', err.message);
      reject(err);
    });

    serverProcess.on('exit', (code) => {
      console.log(`[server] exited (${code})`);
      serverProcess = null;
    });

    setTimeout(() => reject(new Error('Server did not start within 15s')), 15000);
  });
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'CollabGrid',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const menuTemplate = [
    {
      label: '文件',
      submenu: [
        { label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: '重做', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: '复制', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: '粘贴', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: '全选', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '实际大小', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { label: '放大', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
        { label: '缩小', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { type: 'separator' },
        { label: '全屏', accelerator: 'F11', role: 'togglefullscreen' },
        { label: '开发者工具', accelerator: 'F12', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: '刷新', accelerator: 'CmdOrCtrl+R', role: 'reload' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));

  mainWindow.loadURL(`http://localhost:${port}`);
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  try {
    console.log('[Electron] Starting server...');
    const port = await startServer();
    console.log(`[Electron] Server ready on port ${port}`);
    createWindow(port);
  } catch (err) {
    console.error('[Electron] Failed:', err.message);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverProcess) {
    console.log('[Electron] Stopping server...');
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
});
