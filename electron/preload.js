// electron/preload.js — 预加载脚本，暴露安全 API 给渲染进程
const { contextBridge, clipboard } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  clipboard: {
    readText: () => clipboard.readText(),
    writeText: (text) => clipboard.writeText(text),
  },
  platform: process.platform,
});

// 监听主进程发来的端口号
const { ipcRenderer } = require('electron');
ipcRenderer.on('server-port', (_event, port) => {
  // 在 index.html 加载前注入 BASE_URL
  window.__CG_SERVER_PORT__ = port;
  // 触发自定义事件通知前端
  window.dispatchEvent(new CustomEvent('electron-server-port', { detail: { port } }));
});
