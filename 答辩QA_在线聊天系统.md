# 在线聊天系统 — 答辩 Q&A 手册

> 整理老师可能提出的问题及建议回答，按主题分类。每个回答控制在 1-2 分钟口述长度。

---

## 一、架构与设计类

### Q1：为什么选择 B/S 架构而不是 C/S 架构？

**回答**：
B/S 架构（Browser/Server）的核心优势是**零安装、跨平台**。用户只要有浏览器就能使用，不需要下载客户端。对于聊天系统来说，WebSocket 已经让浏览器具备了实时双向通信能力，和原生 App 的体验差距很小。此外，课程重点是 Web 程序设计，B/S 架构能完整覆盖 HTTP、WebSocket、DOM、CSS 等 Web 核心技术。

### Q2：为什么前端不用 Vue 或 React 框架？

**回答**：
这是我有意为之的选择。课程项目的目标是**展示对 Web 底层原理的理解**，而不是熟练使用某个框架。用原生 JavaScript 实现 SPA（单页应用），我需要手动处理 DOM 操作、事件委托、状态管理和模块拆分——这个过程让我真正理解了 Vue/React 在底层做了什么。如果用了框架，老师就不容易判断是我理解了原理，还是框架帮我做了所有事。

当然，在真实项目中我会选择框架来提高开发效率，但课程项目的教学目的不同。

### Q3：为什么要同时用 HTTP 和 WebSocket？只用 WebSocket 不行吗？

**回答**：
理论上可以只用 WebSocket，但这不是最佳实践。两种协议各有擅长：

- **HTTP REST** 适合"请求-响应"场景：注册、登录、搜索、CRUD 操作。这些操作符合 RESTful 语义（GET 查、POST 增、PUT 改、DELETE 删），有明确的状态码（200、400、401、404），缓存友好。
- **WebSocket** 适合"服务端主动推送"场景：消息送达、打字指示、好友申请通知、在线状态变更。这些场景需要低延迟和服务端发起通信。

混用两者能各取所长，也让系统架构更清晰。

### Q4：Socket.IO 和原生 WebSocket 有什么区别？为什么选 Socket.IO？

**回答**：
Socket.IO 是在 WebSocket 之上的一层封装，提供了三个关键增强：

1. **自动降级**：如果网络环境不支持 WebSocket（某些企业防火墙会拦截），Socket.IO 自动切换到 HTTP 长轮询，对应用层透明。
2. **内置房间（Room）机制**：`socket.join('group:123')` + `io.to('group:123').emit()` 天然适合群聊场景，原生 WebSocket 需要自己管理房间映射。
3. **自动重连**：网络断开后自动尝试重连，并支持重连延迟策略。

对课程项目来说，这些特性让我能专注于业务逻辑而非底层协议细节。

---

## 二、数据库与存储类

### Q5：为什么选择 SQLite 而不是 MySQL？

**回答**：
核心原因是**部署成本**。SQLite 是嵌入式数据库，数据存为一个文件（`chat.db`），通过 sql.js（SQLite 的 WebAssembly 版本）直接在 Node.js 进程中运行。这意味着：

- 老师评审时只需 `npm install && npm start` 即可运行，不需要安装和配置 MySQL 服务
- 数据库文件和代码一起管理，方便提交和分享
- sql.js 编译为 WASM，跨平台兼容性好

缺点是不支持并发写入（SQLite 是文件锁），但对于课程项目这种并发量来说不是问题。如果未来需要升级，代码中 `database.js` 封装的接口是统一的，替换底层数据库只需改这一个文件。

### Q6：数据库表是怎么设计的？为什么 friendships 表要存两条记录？

**回答**：
核心是 6 张表：`users`（用户）、`friends`（好友分组）、`friendships`（好友关系）、`groups`（群组）、`group_members`（群成员）、`messages`（消息）。

关于双向存储：当用户 A 和用户 B 成为好友时，`friendships` 表会插入两条记录——`(A, B)` 和 `(B, A)`。这样设计是**以查询效率换存储空间**。好友列表是高频操作（每次打开侧边栏都要加载），如果只在表里存一条，查询时需要用 `WHERE user_id = ? OR friend_id = ?`，无法利用单列索引。双向存储后只需 `WHERE user_id = ?`，查询始终走索引。

### Q7：消息表为什么要把私聊和群聊消息放在同一张表？

**回答**：
通过 `to_id`（私聊接收者）和 `group_id`（群聊目标）两个字段来区分。放在同一张表的好处：

1. **统一的查询接口**：分页加载、搜索、导出的逻辑可以复用
2. **便于扩展**：将来如果要实现"全局搜索聊天记录"，一张表比两张表方便
3. **减少 JOIN**：获取最近联系人时需要同时查私聊和群聊的最新消息，一张表一次查询就能完成

私聊和群聊是两个业务场景，但它们的消息有相同的属性（发送者、内容、类型、时间），在数据层面本质相同。

### Q8：消息分页为什么用游标（cursor）而不是 OFFSET？

**回答**：
传统 `LIMIT 50 OFFSET 100` 在实时聊天中有致命缺陷：用户在翻看历史消息时，新消息仍在不断插入。如果使用 OFFSET，新消息插入会导致之前第 100 条变成第 101 条，用户翻页时会看到重复内容。

游标分页用消息 ID 作为锚点：`WHERE id < {当前最早消息的ID} ORDER BY id DESC LIMIT 50`。无论期间多少新消息插入（它们的 ID 都更大），已加载的消息位置不会变。这是 Twitter、Slack 等产品的标准做法。

---

## 三、安全与认证类

### Q9：密码是怎么存储的？为什么用 bcryptjs？

**回答**：
密码通过 bcrypt 哈希后存储，关键参数是盐值轮次=10：

```javascript
const hashedPassword = bcrypt.hashSync(password, 10);
```

bcrypt 有三大优势：
1. **自带盐值（Salt）**：每个密码的盐值随机生成，即使两个用户密码相同，哈希结果也不同，防止彩虹表攻击
2. **计算代价可控**：轮次参数控制哈希计算量。10 轮约需 50ms，对用户体验无影响，但对暴力破解来说代价高昂——每秒只能尝试约 20 次，而不是 MD5 的数十亿次
3. **专为密码设计**：不像 SHA-256 等通用哈希，bcrypt 的设计目标就是"慢"，这正是密码存储需要的

### Q10：用户登录状态是怎么维持的？

**回答**：
使用 `express-session` 中间件实现基于 Cookie 的服务端 Session：

1. 用户登录成功后，服务端创建 Session 对象，存入 `userId`
2. 服务端返回一个 `Set-Cookie: connect.sid=xxx` 响应头
3. 浏览器后续请求自动携带这个 Cookie
4. 服务端根据 `connect.sid` 查找对应 Session，获取 `userId` 识别用户

Session 持久化在服务端内存中，有效期 24 小时。这个方案的优点是 Session 数据在服务端，客户端无法篡改。

### Q11：WebSocket 连接怎么认证？

**回答**：
Socket.IO 通过中间件共享 Express Session：

```javascript
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});
```

WebSocket 握手时会携带 HTTP Cookie，`sessionMiddleware` 解析出 Session 后挂到 `socket.request.session` 上。后续的 Socket.IO 事件处理中通过 `socket.request.session.userId` 获取当前用户身份。

如果未登录用户尝试建立 WebSocket 连接（没有有效 Session），可以在中间件中拒绝连接。

### Q12：你做了什么防 SQL 注入的措施？

**回答**：
使用**参数化查询（Prepared Statement）**。项目中所有的 SQL 查询都通过 `stmt.bind()` 绑定参数，而不是字符串拼接：

```javascript
// 安全的写法
const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
stmt.bind([username]);

// 危险的写法（项目中没出现）
// db.exec(`SELECT * FROM users WHERE username = '${username}'`); ❌
```

参数化查询将 SQL 结构和数据分离传输，用户输入永远不会被当作 SQL 代码执行，从根本上杜绝注入。

另外，前端和后端都做了输入验证（长度限制、格式校验），形成双重防护。

### Q13：有没有做 XSS 防护？

**回答**：
前端在渲染用户输入的消息内容时，使用 `textContent` 而非 `innerHTML` 来插入文本节点，浏览器会自动转义 HTML 标签：

```javascript
// 安全
element.textContent = userMessage;

// 危险（未使用）
// element.innerHTML = userMessage; ❌
```

这意味着即使有人发送 `<script>alert('xss')</script>`，它会被原样显示为文本，而不会执行。如果需要渲染富文本（如 Emoji），则在转义基础上做安全的替换。

---

## 四、实时通信类

### Q14：Socket.IO 的 Room 机制是怎么工作的？

**回答**：
Room 是 Socket.IO 的服务端概念，本质是"Socket 的分组标签"。关键操作：

- `socket.join('user:123')` — 把当前 Socket 加入名为 `user:123` 的房间
- `io.to('user:123').emit('event', data)` — 向房间内所有 Socket 广播消息
- `socket.leave('group:456')` — 离开房间

使用 Room 的好处是不需要自己维护 `userId → socketId` 的映射表。对于群聊，一个用户可能同时打开多个设备（多个 socket），Room 能让所有设备都收到消息。

### Q15：如果用户不在线，消息怎么处理？

**回答**：
消息发送流程是：**先存数据库，再尝试 Socket.IO 推送**。

如果接收方在线（在其 `user:{userId}` 房间内），消息实时送达。如果不在线，消息已经存入数据库，接收方下次登录后通过 HTTP API 加载历史消息就能看到。

这意味着消息不会丢失——持久化优先于推送。即使用户恰好在线但推送失败（网络波动），消息也已在数据库中，可以重新加载。

### Q16：打字指示器是怎么实现的？为什么需要防抖？

**回答**：
前端监听 `input` 事件：

1. 用户开始输入 → 发送 `typing-start` 事件给接收方
2. 接收方显示"xxx 正在输入..."
3. 用户停止输入 → 启动 1.5 秒计时器
4. 1.5 秒内没有新输入 → 发送 `typing-stop` 事件
5. 接收方隐藏提示文字

**防抖的原因**：如果没有防抖，用户每敲一个字母都会触发一次 `typing-stop`（因为每次输入间隙都很短），导致频繁的 Socket.IO 事件。1.5 秒的等待时间意味着只有真正停止输入时才发送停止事件。

```javascript
clearTimeout(typingTimer);
typingTimer = setTimeout(() => {
  socket.emit('typing-stop', { toUserId });
}, 1500);
```

### Q17：群聊消息怎么确保只发给群成员？

**回答**：
有两层保障：

1. **Socket.IO Room 隔离**：只有加入 `group:{groupId}` 房间的 Socket 能收到该群的消息。用户打开群聊界面时调用 `socket.emit('join-group', groupId)`，服务端才将其加入房间。
2. **数据库权限控制**：获取群消息历史时，服务端先检查请求者是否在 `group_members` 表中，不在则返回 403。

即使有人伪造请求试图获取未加入群的消息，服务端的权限检查会拦截。

---

## 五、前端技术类

### Q18：你这个 SPA 是怎么实现页面切换的？

**回答**：
项目没有使用前端路由库，而是通过**显示/隐藏 DOM 区块**来实现页面切换：

- 所有"页面"（登录、注册、聊天主界面）都是 `index.html` 中的 `<div>` 区块
- 通过 `display: none/block` 切换可见性
- 登录成功后，隐藏登录区块、显示聊天主界面，并加载联系人数据

在聊天主界面内部，右侧面板（好友列表、群组列表）通过类似的可见性切换实现"页签"效果。这是一个简单的方案，胜在直观、无额外依赖。

### Q19：全局 App 对象管理状态有什么优缺点？

**回答**：

**优点**：
- 简单直观，所有模块都能直接访问 `App.currentUser`、`App.friends` 等
- 不需要额外的状态管理库
- 适合中小规模项目

**缺点**：
- 数据变化后需要**手动更新 DOM**（这是最费力的事），不像 Vue/React 有响应式系统自动更新
- 随着项目增长，全局状态容易混乱，难以追踪谁在什么时候修改了数据
- 不支持 time-travel debugging

如果未来重构，我会引入一个简单的发布/订阅模式（EventEmitter），让 DOM 更新逻辑订阅数据变化，而非手动调用。

### Q20：CSS 是怎么组织的？暗色主题怎么做？

**回答**：
整个样式在 `style.css` 一个文件中，约 1400 行。通过 **CSS 自定义属性（CSS Variables）** 管理主题：

```css
:root {
  --bg-primary: #0a0a1a;
  --text-primary: #e0e0e0;
  --accent: #00f0ff;
  --accent-glow: 0 0 20px rgba(0, 240, 255, 0.3);
  --glass-bg: rgba(255, 255, 255, 0.05);
  /* ... */
}
```

所有组件通过 `var(--bg-primary)` 引用颜色。如果要换主题（比如亮色模式），只需改 `:root` 下的变量值，整个界面自动更新。这是 CSS 原生方案，不依赖预处理器。

视觉风格上采用了**暗色赛博朋克风**：深色背景 + 霓虹蓝青色强调 + 毛玻璃效果（`backdrop-filter: blur()`）+ 粒子动画背景。

---

## 六、语音消息类

### Q21：语音消息的完整技术链路是怎样的？

**回答**：

```
[录音]  navigator.mediaDevices.getUserMedia({ audio: true })
   ↓    MediaRecorder 采集 WebM/Opus 编码音频
[编码]  Blob → FileReader.readAsDataURL() → Base64 字符串
   ↓
[传输]  Socket.IO emit('voice-message', { toUserId, audio: base64 })
   ↓
[存储]  服务端: Buffer.from(base64, 'base64') → fs.writeFile(uuid + '.webm')
   ↓      数据库: INSERT INTO messages (type='voice', file_path='/uploads/xxx.webm')
   ↓
[转发]  Socket.IO → 接收方收到消息（包含 file_path）
   ↓
[播放]  前端: <audio src="/uploads/xxx.webm" controls></audio>
```

关键点是语音数据**先落盘再转发**。这是因为语音文件相比文字大得多（几秒录音可能 10-50KB），不适合全部缓存在内存中广播。

### Q22：为什么用 WebM/Opus 格式？

**回答**：
WebM/Opus 是浏览器的默认音频录制格式（`MediaRecorder` 的默认 mimeType），有两个好处：

1. **浏览器原生支持**：Chrome、Firefox、Edge 都直接播放 WebM/Opus，不需要转码
2. **高压缩率**：Opus 编解码器在低码率下音质优秀，适合语音聊天场景

这是一个工程上的务实选择——优先使用浏览器原生能力，减少依赖。

---

## 七、项目工程类

### Q23：项目开发过程中遇到的最大挑战是什么？

**回答**：
最大挑战是**Socket.IO 与 Express Session 的集成**。

初始方案是 WebSocket 握手时没有携带 Session Cookie，导致服务端无法识别 WebSocket 连接的用户身份。我花了不少时间排查，最终发现需要在 Socket.IO 的中间件中复用 Express 的 Session 中间件来解析 Cookie。

另一个挑战是**游标分页的实现**。一开始用了 OFFSET，测试时发现有消息重复的问题，查阅资料后理解了两种分页的本质差异，重构为游标方案。

### Q24：如果要把这个项目部署到生产环境，需要做什么？

**回答**：

1. **反向代理**：前面加 Nginx 处理静态文件、HTTPS、负载均衡
2. **数据库升级**：SQLite → PostgreSQL，使用连接池
3. **Session 存储**：从内存存储改为 Redis，解决多进程 Session 不共享的问题
4. **Socket.IO 适配器**：配置 Redis Adapter，使多进程 Socket.IO 可以跨进程广播
5. **环境变量**：把所有密钥（SESSION_SECRET 等）移到 `.env` 文件
6. **日志和监控**：接入日志系统和错误追踪
7. **CDN**：静态资源使用 CDN 加速
8. **进程管理**：使用 PM2 管理 Node.js 进程

### Q25：项目代码的组织结构是怎样的？前后端怎么通信？

**回答**：

```
server.js       →  HTTP 路由 + Socket.IO 事件处理（Express 入口）
database.js     →  数据库 CRUD 封装（服务端模块）
public/         →  前端静态资源（由 Express.static 托管）
  index.html    →  单页面骨架
  css/style.css →  全局样式
  js/app.js     →  App 全局状态 + 工具函数（API 封装、弹窗、面板）
  js/auth.js    →  登录/注册逻辑
  js/chat.js    →  聊天界面 + 消息收发
  js/friends.js →  好友列表 + 申请处理 + 分组管理
  js/voice.js   →  语音录制/播放
```

前后端通信分两条通道：
- **HTTP**：`fetch()` 调用 REST API（`/api/*`），用于 CRUD 操作
- **WebSocket**：Socket.IO 客户端连接，用于实时消息推送

两者共享同一个 Session，保证认证状态一致。

---

## 八、老师可能的追问

### Q26：你的系统能支持多少并发用户？

**回答**：
作为课程演示，没有做过压力测试。但从架构分析：

- **理论瓶颈在 Socket.IO**：每个活跃 WebSocket 连接占用约 5-10KB 内存，加上 Session 和业务数据，单进程 512MB 内存大约能支撑数千并发连接
- **SQLite 是单写者**：写入操作串行化，高并发写入会有性能瓶颈
- **改进方向**：升级数据库 + Redis Session + Redis Socket.IO Adapter + 多进程 PM2 集群，可以支撑数万并发

### Q27：如果有人发恶意消息（比如刷屏）怎么办？

**回答**：
目前未实现防刷屏机制，但可以加入：

1. **频率限制**：同一用户在 N 秒内最多发送 M 条消息（用内存 Map 记录最近发送时间戳）
2. **内容过滤**：敏感词过滤（简单方案是用正则匹配 + 替换）
3. **用户举报**：长按消息举报，管理员审核

### Q28：如果数据库文件损坏了怎么办？

**回答**：
SQLite 本身有 WAL（Write-Ahead Logging）机制，意外断电后可以自动恢复。此外：
- 可以定期备份 `chat.db` 文件（定时任务 `cp chat.db chat_backup.db`）
- sql.js 支持 `db.export()` 导出完整数据，可以在内存中做完整性校验

### Q29：你的 Emoji 选择器是怎么实现的？

**回答**：
手写了一个轻量级选择器：8 个分类用 Tab 切换，每个分类下有对应的 Emoji 数组（约 200 个）。点击 Emoji 后，通过 `selectionStart`/`selectionEnd` 获取输入框光标位置，在光标处插入 Emoji 字符，然后恢复光标到插入位置之后。

没有用第三方库，因为 emoji 本质就是 Unicode 字符，浏览器原生支持渲染。

### Q30：你从这个项目中学到了什么？

**回答**：

1. **全链路思维**：从浏览器端录音 → Base64 编码 → Socket.IO 传输 → Node.js 处理 → 文件写入 → 数据库存储 → 回显播放，理解了完整的端到端数据流。
2. **协议选择的重要性**：HTTP 和 WebSocket 不是互斥的，设计系统时要根据场景选择最合适的协议。
3. **原生 API 的力量**：在学框架之前，理解原生 DOM、Fetch、WebSocket、MediaRecorder 等 API 能让你知道框架在做什么。
4. **工程权衡**：SQLite vs MySQL、游标分页 vs 偏移分页、双向存储 vs 单条记录——每个选择都有 trade-off。

---

> 📌 建议：回答问题时用项目中的实际代码举例，能显著增加说服力。如果老师问到的问题不在这份手册里，可以结合你实际开发中的经验灵活回答。
