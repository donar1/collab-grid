# public/modules/

前端独立功能模块。从 `app.js` 抽离的可复用组件，每个文件负责一个独立的交互域。

## 文件说明

| 文件 | 作用 |
|------|------|
| `clipboard.js` | 剪贴板操作：支持单元格复制/粘贴、跨表格粘贴、格式化文本解析 |
| `keyboard.js` | 键盘快捷键：方向键导航、Tab 切换单元格、Delete 清空、Escape 取消编辑 |
| `fields.js` | 字段渲染器：根据字段类型（text/number/select/date/link/lookup/formula/currency/button 等）生成对应的 DOM 编辑控件 |
| `links.js` | 关联字段交互：关联记录选择弹窗、搜索过滤、多选管理、关联预览 |

## 模块规范

- 每个模块通过全局函数或事件与 `app.js` 通信
- 不直接操作 `app.js` 内部变量，通过参数传入依赖
- 新增模块需在 `index.html` 中添加 `<script>` 引用
