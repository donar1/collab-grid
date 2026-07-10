# CollabGrid 企业微信消息录入需求文档

**版本**：1.0 | **日期**：2026-06-30 | **接收方**：企业微信智能体

---

## 1. 需求背景

CollabGrid 是一个多维协作表格平台，支持订单管理、库存管理、财务结算等业务模块。当前数据录入完全依赖浏览器手动操作，外出或移动场景下效率低。

需要通过企业微信自建应用实现消息录入：业务人员在企业微信中给应用发文本消息，系统自动解析为 CollabGrid 的表格记录，并返回创建结果。

---

## 2. 整体架构

```
业务人员(企业微信 App)
    │
    │  发文本消息
    ▼
企业微信服务器
    │
    │  POST 回调 (XML + AES 加密)
    ▼
CollabGrid 服务器
    POST /api/webhooks/wecom
    │
    ├── 验签 + 解密
    ├── 解析消息类型
    ├── 匹配录入模板
    ├── 调用 CollabGrid API 创建记录
    ├── 构造回复消息
    └── 加密 + 返回给企业微信
    │
    ▼
企业微信服务器
    │
    │  推送回复消息
    ▼
业务人员(企业微信 App)
```

### 2.1 企业微信侧配置要求

在 CollabGrid 部署后，企业微信管理员需要完成以下操作：

1. **创建自建应用**：企业微信管理后台 → 应用管理 → 创建应用，获取 `AgentId` 和 `Secret`
2. **获取企业信息**：管理后台 → 我的企业 → 企业信息 → 获取 `CorpID`
3. **配置接收消息**：自建应用 → 接收消息 → 设置 API 接收
   - **URL**：`https://your-domain.com/api/webhooks/wecom`
   - **Token**：自定义令牌字符串（用于签名验证）
   - **EncodingAESKey**：自定义 43 位 AES 密钥（用于消息加解密）
4. **设置可信 IP**：自建应用 → 企业可信 IP → 添加 CollabGrid 服务器公网 IP
5. **发布应用**：设置可见范围（指定可以使用的部门或人员）

### 2.2 CollabGrid 侧需要的配置

| 环境变量 | 说明 | 示例值 |
|----------|------|--------|
| `WECOM_ENABLED` | 是否启用企业微信接入 | `true` |
| `WECOM_CORP_ID` | 企业 ID | `ww1234567890` |
| `WECOM_AGENT_ID` | 应用 AgentId | `1000002` |
| `WECOM_SECRET` | 应用 Secret | `your-app-secret` |
| `WECOM_TOKEN` | 回调验证 Token | `your-token-string` |
| `WECOM_ENCODING_AES_KEY` | 回调消息加解密密钥 | 43 位字符串 |

---

## 3. 消息录入协议

### 3.1 消息格式

用户发送的文本消息遵循以下格式：

```
<指令关键词> [分隔符] <字段值1> [分隔符] <字段值2> ...
```

分隔符支持：空格、制表符、逗号、竖线 `|`

### 3.2 指令关键词映射

| 指令关键词 | 对应操作 | 目标表 | 必填字段 |
|---|---|---|---|
| `订单` / `order` | 创建销售订单 | 销售订单区 | 客户名称、产品名称、数量、单价 |
| `采购` / `purchase` | 创建采购订单 | 采购订单区 | 供应商、产品名称、数量、单价 |
| `入库` / `stockin` | 创建入库单 | 出入库操作区 | 产品名称、数量、仓库 |
| `出库` / `stockout` | 创建出库单 | 出入库操作区 | 产品名称、数量、仓库 |
| `客户` / `customer` | 创建客户档案 | 资源档案中心 | 客户名称 |
| `产品` / `product` | 创建产品 | 产品信息 | 产品名称、产品类别 |
| `查询` / `query` | 查询记录 | 根据关键词识别 | 查询目标 + 查询条件 |
| `帮助` / `help` | 显示指令列表 | 无 | 无 |

### 3.3 消息示例

**创建订单**：
```
订单 张三 iPhone15 2 5999
```
解析为：客户=张三，产品=iPhone15，数量=2，单价=5999

**创建入库单**：
```
入库 iPhone15|50|主仓库
```
解析为：产品=iPhone15，数量=50，仓库=主仓库

**查询**：
```
查询 订单 张三 本月
```
解析为：查询销售订单区，客户=张三，时间范围=本月

**帮助**：
```
帮助
```
返回所有支持的指令和格式说明

---

## 4. 回复消息格式

系统回复使用企业微信文本消息（markdown 类型），格式如下：

### 4.1 创建成功

```
✅ 销售订单已创建

客户：张三
产品：iPhone15
数量：2
单价：5,999
金额：11,998
订单编号：ORD-20260630-001

查看详情：https://your-domain.com/app
```

### 4.2 创建失败

```
❌ 创建失败

原因：产品 "iPhone15" 未找到
请先在 CollabGrid 中创建该产品记录。

发送 "帮助" 查看可用指令。
```

### 4.3 查询结果

```
📋 查询结果（本月，客户：张三）

序号 | 订单号 | 产品 | 数量 | 金额 | 状态
1 | ORD-001 | iPhone15 | 2 | 11,998 | 待发货
2 | ORD-002 | MacBook | 1 | 9,999 | 已完成

共 2 条记录
```

### 4.4 帮助信息

```
📖 CollabGrid 指令列表

订单 <客户> <产品> <数量> <单价> — 创建销售订单
采购 <供应商> <产品> <数量> <单价> — 创建采购订单
入库 <产品> <数量> <仓库> — 创建入库单
出库 <产品> <数量> <仓库> — 创建出库单
客户 <客户名称> — 创建客户档案
产品 <产品名称> <类别> — 创建产品
查询 <类型> <条件> — 查询记录

示例：订单 张三 iPhone15 2 5999
分隔符支持空格/逗号/竖线
```

---

## 5. 接口规范

### 5.1 验证回调

企业微信首次配置回调 URL 时，会发送 GET 请求验证。

```
GET /api/webhooks/wecom?msg_signature=xxx&timestamp=xxx&nonce=xxx&echostr=xxx
```

服务端处理：
1. 对 `echostr` 进行解密（使用 `WECOM_TOKEN` + `WECOM_ENCODING_AES_KEY`）
2. 返回解密后的明文 `echostr`（Content-Type: text/plain）

### 5.2 接收消息

企业微信收到用户消息后，发送 POST 请求：

```
POST /api/webhooks/wecom?msg_signature=xxx&timestamp=xxx&nonce=xxx
Content-Type: text/xml

<xml>
  <ToUserName><![CDATA[corp_id]]></ToUserName>
  <Encrypt><![CDATA[加密的消息体]]></Encrypt>
  <AgentID><![CDATA[agent_id]]></AgentID>
</xml>
```

服务端处理：
1. 验证 `msg_signature`（SHA1(sort(Token, Timestamp, Nonce, Encrypt))）
2. 解密 `Encrypt` 获取明文 XML
3. 从明文 XML 中提取 `MsgType`、`Content`、`FromUserName`、`MsgId`
4. 根据 `MsgType` 处理（仅处理 `text` 类型，其他返回"暂不支持此消息类型"）
5. 构造回复 XML，加密后返回

### 5.3 消息加解密算法

企业微信消息加解密使用 AES-256-CBC，具体步骤：

**解密**：
1. Base64 解码 Encrypt 字段
2. 取前 16 字节作为 AES key（对 EncodingAESKey 做 Base64 解码）
3. AES-256-CBC 解密（IV = key 前 16 字节）
4. 去除前 16 字节随机字符串和后 4 字节 CorpID
5. 剩余部分为明文 XML

**加密**：
1. 拼接：16 字节随机字符串 + 明文 XML + CorpID
2. AES-256-CBC 加密
3. Base64 编码

**签名验证**：
```
SHA1(Token + Timestamp + Nonce + Encrypt)
```

企业微信官方提供了 `@wecom/crypto` npm 包封装了这些操作，也可自行实现。

### 5.4 回复格式

```xml
<xml>
  <Encrypt><![CDATA[加密的回复内容]]></Encrypt>
  <MsgSignature><![CDATA[签名]]></MsgSignature>
  <TimeStamp><![CDATA[时间戳]]></TimeStamp>
  <Nonce><![CDATA[随机字符串]]></Nonce>
</xml>
```

---

## 6. 业务逻辑

### 6.1 用户身份识别

企业微信消息回调中携带 `FromUserName`（企业微信 UserID）。CollabGrid 需要将企业微信 UserID 映射到 CollabGrid 用户。

**映射方案**：
- `users` 表新增 `wecom_user_id` 字段（VARCHAR(64)，可选）
- 用户在 CollabGrid 设置页面绑定企业微信账号
- 消息回调时通过 `wecom_user_id` 查找对应用户
- 未绑定时回复提示："请先在 CollabGrid 设置中绑定企业微信账号"

### 6.2 创建记录的权限校验

通过企业微信创建记录时，沿用 CollabGrid 现有的权限体系：
- 用户必须是对应 Base 的成员
- 用户角色必须有权创建记录（`business`、`manager`、`owner` 角色）
- 字段锁定保护：被锁定的字段不允许通过消息录入修改

### 6.3 字段匹配规则

| CollabGrid 字段类型 | 匹配规则 |
|---|---|
| text | 直接填入 |
| number | 解析为数字，支持千分位（1,999 → 1999） |
| singleSelect | 模糊匹配已有选项，未匹配到则创建新选项 |
| date | 支持自然语言（今天、昨天、2026-06-30） |
| lookup | 通过名称匹配关联记录，未找到则报错提示 |
| autoNumber | 系统自动生成，忽略用户输入 |
| formula / createdTime / lastModifiedTime | 系统自动计算，忽略用户输入 |

### 6.4 金额自动计算

订单创建时：
- `金额 = 数量 x 单价`（自动计算填入金额字段）
- 如果 CollabGrid 对应 Base 有公式字段配置了金额计算，优先使用公式

### 6.5 幂等处理

同一条企业微信消息（相同 `MsgId`）可能被推送多次（网络重试）。服务端需要：
- 记录已处理的 `MsgId`，缓存 24 小时
- 重复 `MsgId` 直接返回上次的结果，不重复创建记录

---

## 7. 错误处理

| 场景 | 回复消息 |
|---|---|
| 未绑定企业微信 | "请先在 CollabGrid 个人设置中绑定企业微信账号" |
| 无权限创建记录 | "您没有在该工作区创建记录的权限" |
| 必填字段缺失 | "创建失败：缺少必填字段 [产品名称]。格式：订单 <客户> <产品> <数量> <单价>" |
| 产品/客户不存在 | "创建失败：产品 [XXX] 未找到。请先在 CollabGrid 中创建。" |
| 数量/单价格式错误 | "创建失败：数量和单价必须是数字。收到：[abc]" |
| 不支持的指令 | "未知指令：[xxx]。发送 '帮助' 查看可用指令。" |
| 不支持的消息类型 | "暂不支持图片/语音消息。请发送文本消息。" |
| 服务器内部错误 | "系统错误，请稍后重试。"（记录完整日志） |

---

## 8. 安全要求

| 要求 | 说明 |
|---|---|
| 消息加解密 | 必须使用企业微信官方 AES 加解密方案，不可明文传输 |
| 签名验证 | 每个 GET/POST 请求必须验证 `msg_signature` |
| IP 白名单 | 仅接受企业微信服务器 IP 段的回调请求 |
| 频率限制 | 同一用户每分钟最多 30 条消息 |
| 操作审计 | 每次通过企业微信创建/查询记录，写入 `audit_log` |
| 敏感字段脱敏 | 查询回复中的客户信息只显示公司名，不显示联系方式 |

---

## 9. 数据库变更

### 9.1 users 表新增字段

```sql
ALTER TABLE users ADD COLUMN wecom_user_id VARCHAR(64);
CREATE INDEX idx_users_wecom ON users(wecom_user_id);
```

### 9.2 新表：wecom_message_log（可选，用于排查）

```sql
CREATE TABLE wecom_message_log (
  id VARCHAR(21) PRIMARY KEY,
  msg_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(21) NOT NULL,
  from_user_name VARCHAR(64) NOT NULL,
  msg_type VARCHAR(20) NOT NULL,
  content TEXT,
  command VARCHAR(20),
  result_status VARCHAR(20),
  result_detail TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX idx_wecom_msg_id ON wecom_message_log(msg_id);
CREATE INDEX idx_wecom_user ON wecom_message_log(user_id);
```

---

## 10. 需要的新建文件清单

| 文件路径 | 职责 |
|---|---|
| `routes/webhooks/wecom.js` | Express 路由：处理 GET 验证和 POST 消息回调 |
| `services/wecomService.js` | 消息加解密、签名验证、消息解析、回复构造 |
| `services/wecomCommandHandler.js` | 指令匹配、调用 CollabGrid API、构造回复内容 |

需要修改的现有文件：

| 文件 | 变更内容 |
|---|---|
| `server.js` | 注册 webhook 路由（仅 `WECOM_ENABLED=true` 时） |
| `config.js` | 新增企业微信配置项 |
| `.env.example` | 新增企业微信环境变量示例 |

---

## 11. npm 依赖

| 依赖 | 用途 | 是否必须 |
|---|---|---|
| `@wecom/crypto` | 企业微信消息加解密官方库 | 推荐，可手写替代 |

如果不想引入外部依赖，可以手写 AES 加解密（约 50 行代码），使用 Node.js 内置 `crypto` 模块。

---

## 12. 验收标准

| # | 验收项 | 通过条件 |
|---|---|---|
| 1 | 回调 URL 验证 | 企业微信后台配置 URL 时返回验证成功 |
| 2 | 发送"帮助"指令 | 返回完整的指令列表 |
| 3 | 创建销售订单 | 正确解析 4 个字段，金额自动计算，返回订单详情 |
| 4 | 创建入库单 | 正确解析 3 个字段，库存数量正确更新 |
| 5 | 查询记录 | 返回符合条件的记录列表 |
| 6 | 未绑定提示 | 未绑定企业微信时返回绑定提示 |
| 7 | 权限拒绝 | 无权限用户发送指令时返回权限不足提示 |
| 8 | 幂等处理 | 相同消息重复推送时不重复创建记录 |
| 9 | 审计日志 | 每次操作写入 audit_log |
| 10 | 不支持的消息类型 | 发送图片/语音时返回"暂不支持"提示 |

---

## 13. 注意事项

1. 企业微信回调 URL 必须是 HTTPS + 公网可访问的地址，本地开发环境无法接收回调（需要内网穿透工具如 ngrok）
2. 企业微信服务器 IP 段参考官方文档，需要在安全配置中放行这些 IP
3. 消息加解密的 EncodingAESKey 是 43 位字符串，不是任意长度的密钥
4. 企业微信 UserID 格式为纯数字或邮箱前缀，与 CollabGrid 的用户 ID（21 位 nanoid）不同，必须做映射
5. 审批类操作（封账、红冲）不建议通过消息录入，这些操作需要更严格的权限控制和审计追踪
