# CollabGrid 实现日志

更新时间：2026-06-21

## 项目概况

CollabGrid 是一个多维协作表原型，目标是实现类似 Airtable / 飞书多维表的基础能力。当前项目采用 Node.js + Express + SQLite + Socket.IO + 原生前端 JavaScript 实现，主要代码集中在 `server.js`、`db.js`、`public/app.js`、`public/styles.css`。

## 阶段一：基础工作空间能力

用户最早指出工作空间不能重命名、不能删除。项目随后补齐了工作空间级别的基础管理能力：

| 功能 | 当前状态 | 涉及文件 | 说明 |
| --- | --- | --- | --- |
| 工作空间重命名 | 已实现 | `server.js`、`public/app.js` | 新增 `PATCH /api/bases/:id`，侧边栏工作空间项增加「改」按钮。 |
| 工作空间删除 | 已实现 | `server.js`、`public/app.js` | 新增 `DELETE /api/bases/:id`，删除时清理表、字段、记录、单元格、关联、邀请和日志。 |
| 工作空间按钮 | 已实现 | `public/app.js`、`public/styles.css` | 工作空间列表项显示「改」「删」操作。 |

## 阶段二：字段管理能力

用户提出字段名称不能删改，单选项没有添加选项能力。项目补齐了字段级别的管理入口：

| 功能 | 当前状态 | 涉及文件 | 说明 |
| --- | --- | --- | --- |
| 字段重命名 | 已实现 | `server.js`、`public/app.js` | 字段表头增加「改」按钮，也支持双击字段名重命名。 |
| 字段删除 | 已实现 | `server.js`、`public/app.js` | 新增 `DELETE /api/fields/:fieldId`，删除字段及相关单元格、关联。 |
| 字段锁定 | 已实现 | `server.js`、`public/app.js` | 字段可锁定，锁定后单元格写入返回 423。 |
| 单选项维护 | 已实现 | `server.js`、`public/app.js` | 单选字段表头增加「选项」按钮，可添加、删除、保存选项。 |

## 阶段三：单选项颜色

用户希望单选项每个选项都能设置单独颜色。项目将单选项数据结构从字符串数组升级为对象数组，同时兼容旧数据。

| 功能 | 当前状态 | 涉及文件 | 说明 |
| --- | --- | --- | --- |
| 选项颜色数据结构 | 已实现 | `server.js` | `normalizeSelectOptions()` 支持 `{ label, color }`，旧字符串选项会自动转成默认颜色。 |
| 选项颜色 UI | 已实现 | `public/app.js`、`public/styles.css` | 选项编辑器显示「选项名称 / 颜色 / 操作」三列，每个选项右侧有独立色块。 |
| 单选单元格颜色展示 | 已实现 | `public/app.js` | 选择单选项后，单元格左侧和背景显示对应颜色。 |
| 单选合法性校验 | 已实现 | `server.js` | 写入单选字段时，只允许写入已有选项的 `label`。 |

## 阶段四：列宽和行高

用户要求字段宽窄和行高都可调整。项目在数据库层增加字段宽度和记录高度，并在前端支持拖拽调整。

| 功能 | 当前状态 | 涉及文件 | 说明 |
| --- | --- | --- | --- |
| 字段宽度存储 | 已实现 | `db.js` | `fields` 表增加 `width INTEGER DEFAULT 160`。 |
| 字段宽度拖拽 | 已实现 | `public/app.js`、`public/styles.css` | 字段表头右侧增加拖拽手柄，范围 80-600。 |
| 行高存储 | 已实现 | `db.js` | `records` 表增加 `height INTEGER DEFAULT 34`。 |
| 行高拖拽 | 已实现 | `server.js`、`public/app.js`、`public/styles.css` | 新增 `PATCH /api/records/:recordId`，行操作列提供拖拽手柄，范围 28-240。 |

## 阶段五：行删除交互修复

用户反馈调整行高时容易误触中间的 `×` 删除。项目将整格点击删除改为明确按钮。

| 功能 | 当前状态 | 涉及文件 | 说明 |
| --- | --- | --- | --- |
| 明确删除按钮 | 已实现 | `public/app.js`、`public/styles.css` | 行操作列使用「删除」按钮，不再通过单元格整体点击触发删除。 |
| 拖拽防误触 | 已实现 | `public/app.js` | 行高拖拽手柄阻止事件冒泡，避免触发删除。 |

## 阶段六：关联字段

用户指出关联表功能异常，关联关系和备选项显示不出来。项目补齐了关联字段配置、候选记录弹窗和显示列能力。

| 功能 | 当前状态 | 涉及文件 | 说明 |
| --- | --- | --- | --- |
| 关联目标表配置 | 已实现 | `public/app.js` | link 字段表头增加「关联表」按钮，可选择目标表。 |
| 关联显示列 | 已实现 | `public/app.js` | 可指定目标表中哪一列作为关联标签显示。 |
| 关联候选列表 | 已实现 | `public/app.js` | 关联单元格点击后弹出候选记录。 |
| 关联搜索 | 已实现 | `public/app.js`、`public/styles.css` | 弹窗顶部增加「搜索关联记录…」输入框。 |
| 普通关联单选 | 已实现 | `server.js`、`public/app.js` | 选择新记录会替换旧关联；后端插入前删除同一行同一字段旧关联。 |
| 关联多选配置 | 已实现 | `server.js`、`public/app.js`、`public/modules/fields.js` | link 字段支持 `multiple` 配置，单选和多选可在字段配置弹窗中切换。 |
| 多选关联弹窗 | 已实现 | `public/app.js`、`public/modules/links.js` | 多选模式下弹窗不自动关闭，可连续关联多条记录，再次点击已选记录可取消。 |

## 阶段七：lookup 关联字段

用户要求通过关联关系带出源表字段，并区分一次性信息和联动信息。项目新增 `lookup` 字段类型。

| 功能 | 当前状态 | 涉及文件 | 说明 |
| --- | --- | --- | --- |
| 新字段类型 `lookup` | 已实现 | `server.js`、`public/app.js` | 新建字段下拉中增加「关联字段(lookup)」。 |
| lookup 配置 | 已实现 | `public/app.js` | 可选择本表 link 字段、目标表源字段、同步方式。 |
| 联动模式 | 已实现 | `public/app.js` | 前端按当前关联和源表单元格实时计算显示值。 |
| 锁定模式 | 已实现 | `server.js`、`public/app.js` | 建立或变更关联时写入快照值，源数据后续变化不影响已保存值。 |
| lookup 只读 | 已实现 | `server.js` | 直接写 lookup 单元格返回 400。 |

## 阶段八：复制粘贴和批量新增

用户指出不能一次性选中多行多列复制粘贴，粘贴创建多行也未实现。项目增加了表格选区、复制 TSV、粘贴 TSV 和追加创建多行。

| 功能 | 当前状态 | 涉及文件 | 说明 |
| --- | --- | --- | --- |
| 多单元格选区 | 已实现 | `public/app.js`、`public/styles.css` | 鼠标拖拽可选择矩形区域，选区有高亮样式。 |
| 复制选区 | 已实现 | `public/app.js` | `copy` 事件将选区导出为 TSV。 |
| 粘贴到选区 | 已实现 | `public/app.js` | 有选区时，从选区左上角开始写入剪贴板表格数据。 |
| 粘贴追加多行 | 已实现 | `public/app.js` | 无选区或点「添加一行 / 粘贴多行」时，按剪贴板行数自动创建记录。 |
| 粘贴去重修复 | 已实现 | `public/app.js` | 修复 Socket.IO `record:add` 回推与本地 `push` 重复造成“两行只新增一行”的问题。 |
| 缓存规避 | 已实现 | `public/index.html` | `app.js` 和 `styles.css` 加版本号，避免浏览器使用旧代码。 |

## 阶段九：键盘导航

用户要求增加上下左右光标移动、`Tab` 同行移动、`Enter` 同列移动。项目实现了单元格级键盘导航。

| 功能 | 当前状态 | 涉及文件 | 说明 |
| --- | --- | --- | --- |
| 方向键导航 | 已实现 | `public/app.js` | 非编辑态下，方向键移动到相邻单元格。 |
| Tab 横向移动 | 已实现 | `public/app.js` | `Tab` 右移，`Shift + Tab` 左移。 |
| Enter 纵向移动 | 已实现 | `public/app.js` | `Enter` 下移，`Shift + Enter` 上移。 |
| 自动聚焦目标单元格 | 已实现 | `public/app.js` | 移动后目标单元格获得焦点并显示选中状态。 |

## 阶段十：选中态与编辑态

评审后将键盘体验作为 P0 改进项。项目区分了单元格选中态和输入编辑态，避免方向键和文本光标冲突。

| 功能 | 当前状态 | 涉及文件 | 说明 |
| --- | --- | --- | --- |
| 默认选中态 | 已实现 | `public/app.js` | 单击单元格只选中，不直接编辑。 |
| 进入编辑态 | 已实现 | `public/app.js` | `F2`、双击或直接输入字符进入编辑态。 |
| 编辑态方向键 | 已实现 | `public/app.js` | 编辑态下方向键留给输入框移动光标，不跳格。 |
| Esc 取消编辑 | 已实现 | `public/app.js` | `Esc` 恢复原值并退出编辑态。 |
| Enter / Tab 提交移动 | 已实现 | `public/app.js` | 编辑态下提交当前输入，并移动到下一格。 |
| Delete / Backspace 清空选区 | 已实现 | `public/app.js` | 清空选区内可写单元格，跳过锁定字段、关联字段、lookup 字段。 |
| 编辑态样式 | 已实现 | `public/styles.css` | 编辑态单元格有独立高亮样式，退出后清理样式。 |

## 阶段十一：P0/P1 工程化改进

评审后按 P0/P1 改进项推进，重点补自动化测试、拆分前端模块、强化后端校验，并把关联字段从固定单选升级为可配置单选/多选。

| 功能 | 当前状态 | 涉及文件 | 说明 |
| --- | --- | --- | --- |
| 剪贴板模块 | 已实现 | `public/modules/clipboard.js`、`public/app.js` | 拆出 TSV 解析、单元格清理、选区归一化。 |
| 键盘模块 | 已实现 | `public/modules/keyboard.js`、`public/app.js` | 拆出方向键、Tab、Enter 的移动坐标计算。 |
| 字段模块 | 已实现 | `public/modules/fields.js`、`public/app.js` | 拆出单选项规范化、link 多选配置判断。 |
| 关联文案模块 | 已实现 | `public/modules/links.js`、`public/app.js` | 拆出单选/多选关联弹窗标题、说明、摘要文案。 |
| 前端逻辑测试 | 已实现 | `tests/frontend_logic_test.js`、`package.json` | 新增 `npm run test:frontend`，覆盖剪贴板、键盘、字段、关联模块。 |
| 统一语法检查脚本 | 已实现 | `package.json` | 新增 `npm run check`，检查后端、主前端脚本和拆分模块。 |
| lookup 后端校验 | 已实现 | `server.js` | 校验 link 字段必须属于当前表，源字段必须属于目标表，源字段不能是 link/lookup。 |
| link 配置后端校验 | 已实现 | `server.js` | 校验目标表和显示列必须属于当前工作空间。 |
| 关联单选/多选开关 | 已实现 | `server.js`、`public/app.js` | 单选模式保持替换旧关联；多选模式允许同一行关联多条记录。 |

## 阶段十二：业务系统 P0 底座

按产品-订单-库存-结算系统的基础要求，先补通用底座，避免把业务能力硬编码成臃肿单体。当前方案把字段类型、业务模板、记录封账、按钮动作、批量事务和分页加载作为底层能力，后续销售发货、采购入库、充值、退款、红冲等脚本都挂在这套底座上。

| 功能 | 当前状态 | 涉及文件 | 说明 |
| --- | --- | --- | --- |
| 分页快照 | 已实现 | `server.js`、`public/app.js` | `/api/bases/:id` 每表默认只返回前 200 条记录，单表分页接口 `/api/tables/:tableId/page` 支持 20-500 条一页。 |
| 大数据索引 | 已实现 | `db.js` | 增加 `records(table_id, position, created_at)`、`cells(field_id)`、`links(to_record_id)` 等索引，支撑几十万级记录增长。 |
| 自动编号字段 | 已实现 | `server.js`、`public/app.js` | `autoNumber` 按记录顺序生成编号，支持前缀、起始值和补零位数。 |
| 公式字段 | 已实现 | `server.js`、`public/app.js` | `formula` 支持 `{字段名}` 占位符和 `+ - * / ()`，用于金额、剩余量等基础计算。 |
| 金额字段 | 已实现 | `server.js`、`public/app.js` | `currency` 支持货币符号和精度，后端按数字校验。 |
| 按钮字段 | 已实现 | `server.js`、`public/app.js` | `button` 可触发封账和解除封账动作。 |
| 创建时间字段 | 已实现 | `server.js`、`public/app.js` | `createdTime` 只读显示记录创建日期。 |
| 复选框字段 | 已实现 | `server.js`、`public/app.js` | `checkbox` 保存布尔状态。 |
| 业务模板初始化 | 已实现 | `server.js`、`public/app.js` | 一键生成产品、销售订单、采购订单、库存、结算、退款、客户账户、资金流水、预存设备、设备使用记录表。 |
| 记录级封账 | 已实现 | `db.js`、`server.js`、`public/app.js` | `records.locked` 控制行级锁定，封账后禁止编辑单元格、删除记录、修改关联。 |
| 批量事务接口 | 已实现 | `server.js` | `/api/batch` 支持最多 500 个单元格更新操作在一个事务内完成。 |
| P0 API 测试 | 已实现 | `tests/p0_api_test.js`、`package.json` | 新增 `npm run test:p0`，覆盖业务模板、自动编号、公式、按钮封账、分页接口。 |

## 阶段十三：资源档案中心

按资源档案管理的需求新增专用基础表单，同时补齐单页面筛选和字段显示自定义。当前实现仍沿用通用表格底座，资源审批动作以按钮动作扩展，不把审批逻辑写死在前端。

| 功能 | 当前状态 | 涉及文件 | 说明 |
| --- | --- | --- | --- |
| 资源档案模板 | 已实现 | `server.js`、`public/app.js` | 新增「资源档案」入口，只创建一张「资源档案中心」底表。 |
| 资源档案中心 | 已实现 | `server.js` | 包含代码、入档日期、企业名称、对接人、电话、地址、身份信息、身份证明、审批领导、审批意见、审批状态、数据可使用、建群对接、业务备注、待办、审批按钮。 |
| 审批领导字段 | 已实现 | `server.js` | 审批领导改为当前资源表内的普通单选审批字段，不再生成审批领导账户表。 |
| 同表规则视图 | 已实现 | `public/app.js`、`public/styles.css` | 支持全部档案、待审批、领导审批、已通过可用、待办处理；各视图基于同一底表按规则筛选和显示字段。 |
| 附件字段 | 已实现 | `server.js`、`public/app.js`、`public/styles.css` | 新增 `attachment` 字段，用于保存图片、身份证明、营业执照或凭证链接；图片链接可显示缩略预览。 |
| 资源审批动作 | 已实现 | `server.js` | `approve_resource` 会把审批状态改为已通过、数据可使用改为 true、待办改为已完成、建群对接改为已正常对接，并封账当前记录。 |
| 当前页筛选 | 已实现 | `public/app.js`、`public/styles.css` | 表格上方新增筛选输入框，按当前页可见字段内容快速过滤。 |
| 字段显示自定义 | 已实现 | `public/app.js`、`public/styles.css` | 表格上方新增「显示字段」菜单，可临时隐藏/显示字段。 |
| 资源档案测试 | 已实现 | `tests/resource_archive_test.js`、`package.json` | 新增 `npm run test:resource`，覆盖单表模板结构、附件字段、审批按钮和审批后字段更新。 |

## 阶段十四：产品信息区

按产品资料维护需求新增产品名称数据源和产品信息区。产品信息区保留业务录入字段，产品名称与货号由数据源维护，避免同一产品在不同地区、规则、状态下重复录入货号。

| 功能 | 当前状态 | 涉及文件 | 说明 |
| --- | --- | --- | --- |
| 产品信息模板 | 已实现 | `server.js`、`public/app.js` | 新增「产品信息」入口，创建产品名称数据源区和产品信息区。 |
| 产品名称数据源区 | 已实现 | `server.js` | 维护产品名称、货号、数据状态、备注。 |
| 产品信息区 | 已实现 | `server.js` | 包含标题、更新时间、名称、规格、地区、货号、销售规则、下单方式、产品状态、销售状态、详情、售价、税费、税种、供应商、成本、历史供应商、产品分类。 |
| 名称选择 | 已实现 | `server.js`、`public/app.js` | 产品信息区的名称是关联字段，从产品名称数据源区选择。 |
| 货号引用 | 已实现 | `server.js`、`public/app.js` | 货号是 lookup 字段，随名称选择从产品名称数据源区引用。 |
| 合成标题 | 已实现 | `server.js`、`public/app.js` | 新增 `textFormula` 字段类型，用 `{字段名}` 合成标题文本。 |
| 产品信息测试 | 已实现 | `tests/product_info_test.js`、`package.json` | 新增 `npm run test:product`，覆盖模板结构、名称关联、货号 lookup 配置和基础录入。 |

## 阶段十五：团队权限与大数据引用底座

为后续订单系统和结算系统做协作与数据规模准备。本阶段先完善工作区角色、邀请、成员管理、审批权限和关联搜索，避免产品上万条、资源上千条时仍依赖首屏数据。

| 功能 | 当前状态 | 涉及文件 | 说明 |
| --- | --- | --- | --- |
| 角色体系 | 已实现 | `server.js` | 支持 owner、admin、approver、finance、editor、viewer。 |
| 权限校验 | 已实现 | `server.js` | viewer 只读；owner/admin 管结构和成员；approver 可审批；手动解封仅 owner/admin。 |
| 邀请角色 | 已实现 | `server.js`、`public/app.js` | 生成邀请链接时可选择 admin、approver、finance、editor、viewer。 |
| 成员管理 | 已实现 | `server.js`、`public/app.js`、`public/styles.css` | 新增「成员」面板，owner/admin 可调整成员角色。 |
| 服务端搜索 | 已实现 | `server.js` | 新增 `/api/tables/:tableId/search`，按展示字段搜索目标表记录，最多返回 100 条。 |
| 关联选择器改造 | 已实现 | `public/app.js` | 关联弹窗输入关键词时走服务端搜索，不再只依赖首屏 200 条。 |
| 搜索索引 | 已实现 | `db.js` | 新增 `cells(field_id, value)` 索引，支撑产品名称、资源名称等展示字段搜索。 |
| 团队与规模测试 | 已实现 | `tests/team_scale_test.js`、`package.json` | 新增 `npm run test:team-scale`，覆盖角色邀请、权限限制、审批权限和数据源尾部搜索。 |

## 阶段十六：业务锁定区

按佣金结算和渠道状态管理需求新增业务锁定区。当前先完成数据结构、关联关系、审批动作和服务端 lookup 计算，为后续订单结算脚本做数据准备。

| 功能 | 当前状态 | 涉及文件 | 说明 |
| --- | --- | --- | --- |
| 业务锁定模板 | 已实现 | `server.js`、`public/app.js` | 新增「业务锁定」入口，创建业务锁定区；缺失时创建员工档案中心和状态变更日志。 |
| 业务锁定区字段 | 已实现 | `server.js` | 包含合作渠道、合作关系、商品、分组、判断、申请人、资源状态、审批结果、申请原因、申请日期、审批人、审批时间、粘贴凭证、负责人 lookup、产品ID lookup、今日奖金、月度奖金、累计奖金、奖金明细、审批按钮。 |
| 员工档案中心 | 已实现 | `server.js` | 包含员工编号、员工姓名、岗位、联系电话、在职，用作申请人关联目标。 |
| 状态变更日志 | 已实现 | `server.js` | 包含日志编号、业务锁定记录、原资源状态、新资源状态、变更原因、变更时间。 |
| 产品ID | 已实现 | `server.js` | 产品信息区新增 `产品ID` 自动编号，业务锁定区通过商品字段 lookup 引用。 |
| 字段类型扩展 | 已实现 | `server.js`、`public/app.js` | 新增 `multiLineText`、`lastModifiedTime`、`lastModifiedBy`。 |
| 业务锁定审批 | 已实现 | `server.js`、`public/app.js` | 新增 `approve_business_lock` 按钮动作，把判断改为关联、审批结果改为已通过；单品合作区商品为空时拒绝审批。 |
| 审批后保护 | 已实现 | `server.js` | 审批通过后保护合作渠道、合作关系、商品、分组、申请人、判断、审批结果；状态和奖金字段仍可由脚本更新。 |
| 奖金字段修订 | 已实现 | `server.js` | 今日奖金、月度奖金、累计奖金改为 `currency`，新增奖金明细 `multiLineText`。 |
| 佣金规则确认 | 已记录 | `待确认问题汇总.md` | 同渠道多负责人只给最新审批通过记录；退款冲回历史佣金；自然月归零；结算批次防重复累加；截单口径按财务付款时间。 |
| 服务端 live lookup | 已实现 | `server.js` | 分页和快照接口返回 live lookup 计算值，后续结算脚本可直接读取。 |
| 业务锁定测试 | 已实现 | `tests/business_lock_test.js`、`package.json` | 新增 `npm run test:business-lock`，覆盖依赖校验、字段结构、关联、lookup 和审批动作。 |

## 阶段十七：订单管理区

按订单全生命周期需求新增订单管理区。当前完成订单主表结构、产品默认值带出、结算快照字段、完结保护和佣金控制字段，为状态脚本、佣金结算脚本、退款冲回和财务对账做准备。

| 功能 | 当前状态 | 涉及文件 | 说明 |
| --- | --- | --- | --- |
| 订单管理模板 | 已实现 | `server.js`、`public/app.js` | 新增「订单管理」入口，创建订单管理区。 |
| 依赖校验 | 已实现 | `server.js` | 创建订单管理区前必须已有资源档案中心和产品信息区。 |
| 订单基础字段 | 已实现 | `server.js` | 分区、订单状态、产品、付款方、收款方、数量、地址、备注、接单日期、完结日期、财务付款时间、订单ID、姓名、电话。 |
| 财务字段 | 已实现 | `server.js` | 应收金额、应付金额、付款差额、收款差额、差额说明、实收金额、实付金额、毛利、毛利率。 |
| 跟单字段 | 已实现 | `server.js` | 物流单号、物流备注、物流更新日期、退货单号、售后说明、责任业务、计划日期、完结状态。 |
| 返利字段 | 已实现 | `server.js` | 事由、返利状态、返利备注、返利日期。 |
| 快照字段 | 已实现 | `server.js` | 快照毛利、快照实收、快照实付、快照产品名、快照付款方名、快照收款方名。 |
| 结算控制 | 已实现 | `server.js` | 佣金已结算、佣金结算批次、原订单。 |
| 产品默认值带出 | 已实现 | `server.js` | 选择产品后自动把产品售价写入应收金额、产品成本写入应付金额，并把产品供应商关联为收款方。 |
| 订单默认值 | 已实现 | `server.js` | 新增订单默认写入分区=下单区、事由=订单、佣金已结算=false。 |
| 完结保护 | 已实现 | `server.js` | 订单进入完结区且完结日期/财务付款时间已有值后，不允许再次修改。 |
| 快照保护 | 已实现 | `server.js` | 快照字段和佣金结算批次一旦写入，不允许覆盖。 |
| 已结算保护 | 已实现 | `server.js` | 佣金已结算后，订单关联字段不可修改。 |
| 订单测试 | 已实现 | `tests/order_management_test.js`、`package.json` | 新增 `npm run test:order`，覆盖依赖校验、默认值、产品带出、公式、lookup、保护规则。 |

## 阶段十八：作业中心、资源状态作业和佣金结算作业

新增作业中心第一版。当前先支持手动试算和手动执行，不接自动定时，便于先用真实数据验证规则。作业逻辑拆到 `jobs/` 目录，后续可以独立修改状态规则、佣金规则、诊断规则。

| 功能 | 当前状态 | 涉及文件 | 说明 |
| --- | --- | --- | --- |
| 作业中心入口 | 已实现 | `public/app.js`、`public/styles.css` | 顶部新增「作业中心」，可选择业务日期、试算模式、执行资源状态作业和佣金结算作业。 |
| 作业配置 | 已实现 | `db.js`、`jobs/index.js` | 新增 `job_configs`，支持 enabled、dry_run、batch_size、max_runtime_ms、config_json。 |
| 作业执行记录 | 已实现 | `db.js`、`jobs/index.js` | 新增 `job_runs`，记录业务日期、模式、状态、扫描数、变更数、摘要和错误。 |
| 佣金流水 | 已实现 | `db.js`、`jobs/commissionJob.js` | 新增 `commission_ledger`，普通佣金和退款冲回都写流水，唯一约束防重复。 |
| 订单日活动聚合 | 已实现 | `db.js`、`jobs/statusJob.js` | 新增 `order_activity_daily`，状态作业按日期、方向、渠道、产品聚合订单活动。 |
| 资源状态作业 | 已实现 | `jobs/statusJob.js` | 按财务付款时间、渠道负责区 30 天窗口、单品合作区 7 天窗口更新活跃/正常/沉淀。 |
| 佣金结算作业 | 已实现 | `jobs/commissionJob.js` | 写快照、匹配业务锁定区、写佣金流水、汇总奖金、标记订单已结算。 |
| 退款冲回通道 | 已实现 | `jobs/commissionJob.js` | 退款订单通过原订单查询历史佣金流水，生成负向 `refund_reverse` 流水。 |
| 作业 API | 已实现 | `server.js` | 新增作业配置、执行、执行记录查询接口。 |
| 作业测试 | 已实现 | `tests/jobs_test.js`、`package.json` | 新增 `npm run test:jobs`，覆盖 dry-run、正式执行、重复执行防重。 |

## 阶段十九：诊断中心与批量订单导入

根据 500 单压力测试结果补充批量订单导入和诊断中心。批量导入解决逐条 API 写入慢的问题；诊断中心为后续智能体排查数据错误提供只读结构化接口。

| 功能 | 当前状态 | 涉及文件 | 说明 |
| --- | --- | --- | --- |
| 诊断中心入口 | 已实现 | `public/app.js`、`public/styles.css` | 顶部新增「诊断中心」，可按业务日期运行诊断并展示严重程度、数量、样例和建议。 |
| 诊断接口 | 已实现 | `server.js`、`jobs/diagnostics.js` | 新增 `/api/bases/:baseId/diagnostics`，只读返回结构化问题列表。 |
| 诊断项 | 已实现 | `jobs/diagnostics.js` | 检查完结区缺财务付款时间、已结算缺快照、退款缺原订单、完结未结算、已结算无批次、已结算无流水、已解绑仍有流水、疑似重复流水、失败作业。 |
| 批量订单导入 | 已实现 | `server.js` | 新增 `/api/bases/:baseId/bulk/orders`，单次最多 5000 条订单。 |
| 批量导入默认值 | 已实现 | `server.js` | 自动建立产品、付款方、收款方、原订单关联，并带出产品售价、成本和默认供应商。 |
| 诊断与批量测试 | 已实现 | `tests/diagnostics_bulk_test.js`、`package.json` | 新增 `npm run test:diagnostics`，覆盖批量导入和诊断问题识别。 |

## 阶段二十：订单布局和右键菜单

根据手动验证反馈优化界面布局。顶部模板、作业、诊断等入口不再全部占用横向空间，统一收进数据表名称栏右键菜单；字段设置统一收进字段表头右键菜单；订单管理区字段按业务使用顺序重新排列。

| 功能 | 当前状态 | 涉及文件 | 说明 |
| --- | --- | --- | --- |
| 顶部入口收纳 | 已实现 | `public/app.js`、`public/styles.css` | 顶部仅保留「+ 字段」和提示，其余入口通过数据表名称栏右键菜单打开。 |
| 表名栏右键菜单 | 已实现 | `public/app.js`、`public/styles.css` | 仅在数据表名称标签区域右键打开操作日志、成员、邀请、模板、资源档案、产品信息、业务锁定、订单管理、作业中心、诊断中心、新建字段。 |
| 字段表头右键菜单 | 已实现 | `public/app.js`、`public/styles.css` | 在字段名称/表头上右键打开字段重命名、选项/关联配置、锁定、宽度提示、删除。 |
| 字段统一管理 | 已实现 | `public/app.js`、`public/styles.css` | 新增「字段管理」面板，集中控制字段显示/隐藏。 |
| 字段自定义排序 | 已实现 | `server.js`、`public/app.js`、`public/styles.css` | 字段管理内每个字段支持上移/下移，字段 `position` 保存到后端，刷新后保留顺序。 |
| 单元格格式编辑 | 已实现 | `db.js`、`server.js`、`public/app.js`、`public/styles.css` | 在字段管理中对当前选中单元格调整字号、字体颜色、单元格颜色，格式保存到 `cells.style_json`。 |
| 字段管理防误触 | 已实现 | `public/app.js` | 字段列表行不再用 label 包裹，点击字段名只选中字段，不会触发隐藏；只有勾选框控制显示/隐藏。 |
| 视图配置持久化 | 已实现 | `public/app.js` | 字段显示/隐藏保存到本地视图配置，刷新后仍保留。 |
| 数据表名称显示 | 已实现 | `public/styles.css` | 表名栏支持横向滚动，长表名省略显示，悬停 title 展示完整名称，当前选中表给更大宽度。 |
| 订单字段重排 | 已实现 | `server.js` | 新建订单管理区时自动按基础录入、财务、跟单、返利、快照、结算控制、系统辅助排序。 |
| 既有表布局更新 | 已执行 | 数据库字段配置 | 已对现有 11 张订单管理区同步更新字段顺序和宽度。 |

## 后端接口变化

| 接口 | 方法 | 用途 |
| --- | --- | --- |
| `/api/bases/:id` | `PATCH` | 重命名工作空间。 |
| `/api/bases/:id` | `DELETE` | 删除工作空间。 |
| `/api/bases/:id` | `GET` | 返回工作空间快照；为控制数据量，每张表默认只返回首屏记录。 |
| `/api/tables/:tableId/page` | `GET` | 分页读取单表记录、单元格和关联。 |
| `/api/tables/:tableId/search` | `GET` | 服务端搜索目标表记录，用于大数据量关联选择。 |
| `/api/bases/:baseId/templates/business-core` | `POST` | 初始化产品-订单-库存-结算业务模板。 |
| `/api/bases/:baseId/templates/resource-archive` | `POST` | 初始化资源档案中心模板。 |
| `/api/bases/:baseId/templates/product-info` | `POST` | 初始化产品名称数据源区和产品信息区模板。 |
| `/api/bases/:baseId/templates/business-lock` | `POST` | 初始化业务锁定区、员工档案中心和状态变更日志。 |
| `/api/bases/:baseId/templates/order-management` | `POST` | 初始化订单管理区。 |
| `/api/bases/:baseId/jobs/configs` | `GET` | 查询作业配置。 |
| `/api/bases/:baseId/jobs/configs/:jobKey` | `PATCH` | 修改作业开关和配置。 |
| `/api/bases/:baseId/jobs/:jobKey/run` | `POST` | 手动试算或执行作业。 |
| `/api/bases/:baseId/jobs/runs` | `GET` | 查询作业执行记录。 |
| `/api/bases/:baseId/jobs/runs/:runId` | `GET` | 查询单次作业详情。 |
| `/api/bases/:baseId/diagnostics` | `GET` | 运行只读数据诊断。 |
| `/api/bases/:baseId/bulk/orders` | `POST` | 批量导入订单。 |
| `/api/fields/:fieldId` | `DELETE` | 删除字段。 |
| `/api/fields/:id` | `PATCH` | 修改字段名称、锁定状态、宽度、选项、关联配置、lookup 配置。link/lookup 配置会做后端校验。 |
| `/api/records/:recordId` | `PATCH` | 修改记录高度。 |
| `/api/links` | `POST` | 创建关联；单选模式替换旧关联，多选模式保留多条关联。 |
| `/api/links/:id` | `DELETE` | 删除关联。 |
| `/api/buttons/execute` | `POST` | 执行按钮动作，当前支持封账和解除封账。 |
| `/api/batch` | `POST` | 批量事务写入，当前支持 `cell.update`。 |
| `/api/bases/:baseId/invites` | `POST` | 按指定角色生成工作区邀请链接。 |
| `/api/bases/:baseId/members/:userId` | `PATCH` | owner/admin 调整成员角色。 |

## 数据库结构变化

| 表 | 字段 | 说明 |
| --- | --- | --- |
| `fields` | `width INTEGER DEFAULT 160` | 字段宽度。 |
| `records` | `height INTEGER DEFAULT 34` | 行高。 |
| `records` | `locked INTEGER DEFAULT 0` | 记录级封账状态。 |
| `records` | `updated_at INTEGER` | 记录最后更新时间。 |
| `fields.options` | JSON | 保存单选项、关联配置、lookup 配置；link 字段新增 `multiple`。 |
| `cells` | `idx_cells_field_value` | 字段值搜索索引，服务于大数据关联搜索。 |
| 字段类型 | `multiLineText` | 多行文本，奖金字段和日志说明使用。 |
| 字段类型 | `lastModifiedTime`、`lastModifiedBy` | 自动展示记录最后修改时间和最后修改人。 |
| 作业表 | `job_configs`、`job_runs` | 作业开关、试算、执行记录和错误追踪。 |
| 佣金表 | `commission_ledger` | 佣金流水和退款冲回流水。 |
| 聚合表 | `order_activity_daily` | 订单日活动聚合，支撑状态窗口计算。 |

## 最近验证记录

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| `node --check public/app.js` | 通过 | 前端脚本语法检查通过。 |
| `node --check server.js` | 通过 | 后端脚本语法检查通过。 |
| `npm run check` | 通过 | 后端、主前端脚本和拆分模块语法检查通过。 |
| `npm run test:frontend` | 通过 | 前端逻辑模块测试通过。 |
| `npm run test:p0` | 通过 | 业务系统 P0 API 测试通过。 |
| `npm run test:resource` | 通过 | 资源档案中心 API 测试通过。 |
| `npm run test:product` | 通过 | 产品信息区 API 测试通过。 |
| `npm run test:team-scale` | 通过 | 团队权限与大数据搜索测试通过。 |
| `npm run test:business-lock` | 通过 | 业务锁定区 API 测试通过。 |
| `npm run test:order` | 通过 | 订单管理区 API 测试通过。 |
| `npm run test:jobs` | 通过 | 作业中心、状态作业和佣金结算作业测试通过。 |
| `npm run test:diagnostics` | 通过 | 诊断中心与批量导入测试通过。 |
| `python smoke_test.py` | 通过 | API 冒烟测试通过。 |
| 浏览器粘贴验证 | 通过 | 粘贴 2 行 TSV 后新增 2 行并写入 4 个单元格。 |
| 普通关联验证 | 通过 | 同一行同一字段只保留 1 条关联。 |
| 多选关联验证 | 通过 | `multiple: true` 时同一行同一字段可保留 2 条关联。 |
| lookup 校验验证 | 通过 | 源字段不属于目标表时返回 400。 |
| 键盘导航验证 | 通过 | 方向键、Tab、Enter 均可移动单元格。 |
| 编辑态验证 | 通过 | 输入字符进入编辑态，编辑态方向键不跳格，`Esc` 取消，`Enter` 保存并移动。 |
| 模块加载验证 | 通过 | 浏览器中 `CollabGridClipboard`、`CollabGridKeyboard`、`CollabGridFields`、`CollabGridLinks` 均可用。 |
| P0 浏览器验证 | 通过 | 「业务模板」入口可见，P0 新版本脚本加载成功。 |
| 资源档案浏览器验证 | 通过 | 「资源档案」入口、筛选框、字段显示菜单和新脚本版本均加载成功。 |
| 产品信息浏览器验证 | 通过 | 名称关联、货号 lookup、标题合成展示均正常。 |
| 团队与规模浏览器验证 | 通过 | 「成员」「邀请」「产品信息」入口和新版脚本加载正常。 |
| 业务锁定浏览器验证 | 通过 | 「业务锁定」入口和新版脚本加载正常。 |
| 右键菜单浏览器验证 | 通过 | 普通数据区域不弹菜单，表名栏右键弹系统菜单，字段表头右键弹字段菜单。 |
| 字段管理浏览器验证 | 通过 | 点击字段名不会误隐藏；单元格格式只作用于当前选中单元格，表头和其他单元格不受影响。 |
| 字段排序浏览器验证 | 通过 | 字段管理内点击「下移」后，表格列顺序立即变化并保存到后端。 |

## 当前遗留事项

| 优先级 | 事项 | 说明 |
| --- | --- | --- |
| P1 | 继续拆分 `public/app.js` | 当前已拆出基础工具模块，后续可继续拆渲染、弹窗、API 状态管理。 |
| P1 | 业务脚本挂接 | 基于 `/api/batch` 和按钮字段，继续实现发货扣库存、采购入库、充值流水、退款、红冲等脚本。 |
| P2 | 批量粘贴增强 | 支持单选项自动匹配、缺失选项提示或自动新增。 |
| P2 | lookup 展示优化 | 支持多值格式、颜色继承、空值占位。 |
| P2 | DOM 级前端自动化测试 | 当前已有逻辑模块测试，后续可补真实浏览器点击、粘贴和弹窗流程测试。 |

## 评审记录

| 日期 | 产出物 | 自评 | 用户评分 | 等级 |
| --- | --- | ---: | ---: | --- |
| 2026-06-20 | CollabGrid 当前项目 | 84.6 | 85.0 | USABLE |
