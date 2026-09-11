# 三人暗棋推进阶段报告（阶段 2–6）

> 本文档记录三人暗棋从 Core 冻结到联机基础架构的推进过程。
> 冻结规则以《三人玩法最终规则》为准（见 docs/architecture.md §13）。

---

## 阶段 2：Core 最终审计与冻结 — COMPLETE

审计范围：GameState / Player / Piece-Faction / GameEngine / Turn / Movement / Capture /
FactionBinding / Stalemate / WinCondition / Draw / Serialization / Session-Command / 2P / 3P。

### 审计结论（逐项）

| 审计项 | 结论 | 依据（测试） |
|---|---|---|
| 淘汰只改变 eliminated + 回合状态，不删棋子 | ✅ | three-player「连续淘汰」（4 子计数 + 象位置断言）、「forfeit 只标记玩家淘汰」 |
| eliminated 不能 reveal/move/capture | ✅ | session「淘汰玩家提交任何动作被拒」（playerEliminated 优先判定）+ 引擎 getLegalActions/validate 防线 |
| eliminated 不能被 forfeit | ✅ | three-player「forfeit 已淘汰…抛错」、session「forfeit 未知/已淘汰」 |
| eliminated 永远不会成为 currentPlayer | ✅ | 引擎轮转跳过 + serialization 拒绝 `currentPlayerId` 指向已淘汰 + smoke 每步断言 |
| 第二名玩家淘汰 → 最后一名未淘汰玩家立即获胜 | ✅ | three-player「连续淘汰」「连续 forfeit」两条路径 |
| 未绑定玩家淘汰：不参与自动分配、不会重新绑定、棋子保留 | ✅ | three-player「forfeit 可淘汰尚未绑定阵营的玩家」（自动分配跳过已淘汰 + factionId 保持 null） |
| winnerPlayerId 双形状支持 | ✅ | `{won, winner: null, winnerPlayerId}`（未绑定获胜）与 `{won, winner: faction}`（棋盘判据）均有引擎断言 + 序列化往返 |
| elimination / forfeit 不破坏和棋机制 | ✅ | 新增「forfeit/僵局淘汰不影响和棋计数与动作日志」（noCaptureCount/turnNumber/actionLog 不变）；重复键含 eliminated 淘汰标记 |
| 不存在 all-eliminated 正常状态 | ✅ | last-active 胜利条件使“活跃=1”即终局；turn.ts 无活跃玩家时抛错而非静默回退 |

### 本阶段修复项

1. **2P 模式接入 `createLastActivePlayerWinCondition`（防御性）**：2P 自身规则不产生淘汰，
   但 `forfeit` 是通用引擎能力——一方被判负后另一方应立即获胜，而非留下无人对局状态。
   现有 2P 行为零变化（正常对局中该条件永不触发），仅使 forfeit 语义完整。
   新增 smoke 测试覆盖（2P forfeit → 对方立即胜、棋子保留）。
2. **新增 forfeit/淘汰不触碰和棋计数的显式测试**（noCaptureCount/turnNumber/actionLog 不变）。

### 结构性推演记录（无代码缺陷，备案）

- “棋盘判据胜利命名了已淘汰玩家的阵营”不可达：第二次淘汰发生时
  “最后活跃玩家获胜”先于局面到达“只剩已淘汰玩家阵营”而终局。
- “全部翻完仍有未绑定玩家”不可达：F2/F3 共 20 枚，未绑定玩家必然翻到其一而绑定，
  随后自动分配闭环。
- 僵局淘汰只可能发生在“该玩家盘上无 F1 子或其子被不可吃敌子围死”的情形；
  淘汰后棋子保留不影响结算闭环（胜利只能由捕获或 last-active 触发）。

### 验证

- vitest：86/86 通过（2P 51 零回归 + 3P 29 + session 15 + smoke 6 + serialization 18 —
  按文件计：rules 11 / engine-extension 7 / session 15 / smoke 6 / three-player 29 / serialization 18）
- core typecheck：通过

**结论：Core 冻结。三人规则与两人规则在当前实现下与冻结规则一致。**

---

## 阶段 3：三人 Web UI 完善 — COMPLETE

修改：
- `apps/web/src/ui/PlayerPanel.tsx`（新增）：A/B/C 座位面板——当前回合高亮、公开阵营显示、
  已淘汰标记（划线 + “已淘汰”角标）。仅展示公共状态，不泄露任何隐藏棋子信息。
- `apps/web/src/ui/BoardView.tsx`：棋盘格尺寸改为 CSS 变量 `--cell-size`。
- `apps/web/src/styles.css`：玩家面板样式；`@media (max-width: 720px) / (max-height: 560px)`
  下棋盘格自动缩至 `min(11vw, 52px)`、间距收紧、提示隐藏——横屏移动端不遮挡棋盘。
- `apps/web/src/App.tsx`：挂载 PlayerPanel（淘汰横幅与结算浮层此前已完成）。

验证：web typecheck 通过；`vite build` 生产构建通过（72 modules，164.91 kB JS）。
限制：无 UI 测试基建，未做渲染自动化测试（按阶段要求以 typecheck + 代码级验证为准）。

---

## 阶段 4：Server 权威联机基础架构 — COMPLETE

新增 `apps/server` 包（名称沿用 docs/architecture.md 既定规划）：

| 文件 | 职责 |
|---|---|
| `src/protocol.ts` | 传输协议：ClientMessage（command/resign）、ServerMessage（welcome/roomStatus/state/eliminated/rejected）、RoomPlayerInfo。安全边界注释：客户端声明的 playerId/faction/eliminated/winner 一律无效。 |
| `src/room.ts` | 传输无关的权威 `GameRoom`：座位分配（服务端发放 playerId + randomUUID 重连令牌）、满员自动开局、指令校验与执行（复用 core `validateCommand`/`engine.apply`）、状态广播、断线保留座位、服务端回合计时（可配置 `turnTimeoutMs`）、权威 `forfeit`（超时/认输）。 |
| `src/index.ts` | WebSocket 桥接：连接 → join/rejoin（URL `?token=` 重连）绑定身份；消息解析最小校验；HTTP 端点输出房间公开状态。 |
| `src/main.ts` | 可运行入口（`pnpm --filter @darkchess/server dev`，默认端口 8787，三人房间）。 |

测试（8/8 通过）：
- `room.test.ts`（7，传输无关）：三人加入自动开局（座位/令牌服务端分配、三连接收到同一初始状态）、
  第四人被拒（roomClosed）、非当前玩家指令拒绝、非法指令拒绝、伪造 playerId 字段无效（按连接身份处理）、
  服务端执行并广播（三客户端状态一致）、resign 权威淘汰（棋子保留、eliminated 事件广播）。
- `ws.integration.test.ts`（1，真实 WebSocket）：完整场景——三人入座、第四人拒绝、A 翻棋广播一致、
  B 消息伪造 playerId:'A' 被按连接身份 B 执行（证明冒充无效）、非当前玩家/非法动作拒绝。

过程中自行修复的问题（Level 1）：
1. `wss.clients` 在 ws 8.x 是 Set 属性而非方法（close 清理崩溃）。
2. 测试 helper 的 close() 在服务端已先行关闭时回调不触发 → 改为 close 事件 + readyState 兜底。
3. waitFor 需要顺序消费语义（否则命中的是开局广播的旧状态）。
4. 指令序列与当前玩家错位导致的断言修正（B 伪造指令被接受后当前玩家是 C）。

依赖：`ws`（运行时）、`tsx`/`@types/node`/`@types/ws`（开发）。lockfile 已更新。

---

## 阶段 5：服务器计时 + Timeout + 基础重连 — COMPLETE

实现（`apps/server/src/room.ts`，计时能力在阶段 4 已内建、本阶段补全测试）：
- **服务器权威计时**：`turnTimeoutMs` 配置；每次开局/行动结算后重置 `setTimeout`（代际计数防陈旧触发，
  `unref` 不阻塞进程）。客户端倒计时只能做 UI——服务器不读客户端时间。
- **超时 → 权威 forfeit**：计时到期时对 `currentPlayerId` 调用 `engine.forfeit`（淘汰、轮转、重新结算），
  绝不自动走子/Pass/随机行动；广播 `eliminated(playerId, 'timeout')` + 新状态。
- **无合法行动不等计时器**：指令结算内的僵局淘汰由引擎立即完成（core 行为），计时器仅在新回合重新武装。
- **重连**：断线仅标记 `connected=false`（座位/身份/棋局/淘汰状态全部保留，计时继续）；
  `rejoin(token)` 凭服务端发放的 randomUUID 令牌恢复原座位并发送最新权威状态；
  不新建玩家、不重置棋局、不改变阵营、不恢复已淘汰玩家的行动资格。
- **安全**：客户端声明的 playerId 等字段一律忽略（连接身份在 join/rejoin 时由服务端绑定）。

新增测试（`room.test.ts`，9 个）：超时判负（轮转/timeout 通知/棋子保留）、正常行动重置计时
（8 连快步无超时）、连续两次超时（最后一人立即获胜、32 子保留）、未配置计时不超时、
断线保留座位且对局继续、rejoin 恢复原 playerId + 最新状态、错误令牌拒绝、
已淘汰玩家重连后不能行动、断线期间超时判负后重连看到自己被淘汰且不能行动。

过程中修复（Level 1/2）：
- 计时测试竞态：60ms 窗口 + 180ms 等待导致超时链式淘汰 → 改为 150ms 窗口 + 220ms 等待，
  单次超时确定性覆盖（未删测试、未降低标准）。
- `wss.clients` 用法（Set 属性非方法）、测试 close 挂起（服务端先行关闭时 ws.close 回调不触发）、
  waitFor 顺序消费语义、集成测试类型收窄——均为测试基建问题，产品代码未受影响。

环境事件记录：一次中断的 `pnpm install` 使各包 `.bin` 链接丢失（vitest/tsx MODULE_NOT_FOUND），
`CI=true pnpm install --no-frozen-lockfile` 一次恢复，无业务代码改动。
`vitest run` 退出码 0，但 worker 清理阶段打印原生栈噪音（ws 句柄在线程池退出时的清理顺序问题，
不影响测试结果，记录为已知噪音）。

## 阶段 6：最终联机验收 — COMPLETE

新增验收测试（`ws.integration.test.ts`）：**完整三人随机对局 over 真实 WebSocket**——
三名客户端以固定种子自动对弈至终局（>0 回合），逐回合断言：
三客户端每步广播一致（deep equal）、turnNumber 连续、当前回合绝不落在已淘汰玩家、
终局状态（胜/和）非 inProgress、三客户端最终权威状态完全一致。

验收矩阵（对应任务书 A–J）：
- A Core：86/86（2P 规则/capture/movement/binding/forced reveal/elimination/forfeit/win/draw/serialization/session）
- B 正常三人流程：阶段 6 集成测试（真实 ws 随机完整对局）
- C 一人挂机：room 测试「超时触发权威判负」（A/B 继续、B 淘汰、棋子保留）
- D 两人挂机：room 测试「连续两次超时」（C 立即获胜、32 子保留）
- E 无行动淘汰：core three-player「连续淘汰」（立即淘汰、不 Pass、轮转跳过）
- F 阵营胜利：core「只剩一个阵营」（faction 判据）
- G 和棋：core 重复 5 次 / 无吃子 40（阈值可配置）
- H 联机一致性：阶段 6 集成测试逐回合 deep equal + 阶段 4 广播一致性
- I 断线重连：room 重连组（原 playerId / 最新状态 / 已淘汰不可行动）
- J 安全：伪造 playerId 无效（room + ws 集成双层）、非当前/非法指令拒绝、淘汰玩家禁行、
  客户端声明的身份字段全部无效

最终验证矩阵：
- core：86/86 通过；server：18/18 通过；smoke：6（含于 core）+ 服务器真实启动 smoke（tsx 启动 + HTTP 状态端点 200）
- typecheck：core OK / server OK / web OK
- web 生产构建：通过（72 modules / 164.91 kB JS）
- 退出码：vitest 全部 0（server worker 清理阶段有非致命原生栈噪音，已记录）

---

# Stage 7：WebSocket 客户端接线与三人浏览器联机试玩 — COMPLETE

## 架构

```text
Browser A/B/C（现有 useGame + UI）
   ↓ WebSocketGameSession（@darkchess/server/client，零 Node 依赖）
   ↓ ws://host/?room=<id>[&token=<重连令牌>]
WebSocket 桥接（多房间路由：?room= 选房、?token= 跨房间恢复座位）
   ↓
GameRoom（权威，未改动） → GameEngine → 广播
```

- **会话语义**：`connectWebSocketGameSession` 在收到 welcome（服务端分配身份）时解析成功；
  房间未满员开局前 `getState()` 返回 null（UI 显示等待房间）；状态广播经 `onState` 连接级事件
  （不遗漏开局广播）与 `subscribe` 双通道到达。
- **与本地 GameSession 的语义差异（异步权威的固有形状，已在接口文档声明）**：
  `submit` 发送后无同步结果——新状态经 subscribe、拒绝经 onRejected 到达；
  客户端不判定 winner/timeout/eliminated；`forfeit` 不暴露给客户端（超时=服务器计时器，认输=resign 消息）。
- **安全边界（保持 Stage 4-6 设计）**：playerId/座位由服务端绑定连接；信封 playerId 声明无效；
  winner/eliminated/timeout/faction 全部来自服务器广播；客户端引擎仅做高亮只读推导。
- **隐藏信息模型（冻结设计）**：单一公共权威状态广播给所有客户端，未翻棋子对所有玩家在 UI
  统一显示为 `?`；不存在 per-player 投影/遮蔽（按冻结规则明确不引入）。状态帧内含隐藏棋子
  身份属于该信任模型的已知属性（记录于 P3）。

## 修改文件

| 文件 | 修改 |
|---|---|
| `apps/server/src/client/websocket-session.ts`（新增） | WebSocketGameSession：connect/submit/subscribe/close，最小 WsLike 结构接口（浏览器与 Node≥22 全局 WebSocket 均满足），连接超时、welcome 即就绪、onState/onRejected/onEliminated/onRoomStatus 事件。 |
| `apps/server/src/index.ts` | 桥接升级为多房间：`?room=` 按需建房、`?token=` 跨房间恢复座位；HTTP 端点列出全部房间；close 清理全部房间与连接。默认单房间用法不变（既有测试零改动）。 |
| `apps/server/package.json` | exports map：`.`/`./client`/`./protocol`（web 按需引用，不引入 Node 类型）。 |
| `apps/web/src/game/useGame.ts` | 拆分为 `useLocalGame`（原热座路径，行为不变）与 `useOnlineGame`（联机：等待开局 null 态、onState 权威状态、服务器淘汰事件通知、重连 attempt 机制、localStorage 令牌持久化）。GameController 增 `online`/`reconnect`/`close`/`state: GameState \| null`。 |
| `apps/web/src/ui/GameView.tsx`（新增） | 共享对局视图：等待房间卡片（已入座列表）、断线卡片（重连/返回）、就绪后复用 StatusBar/PlayerPanel/Notices/Board/DrawProgress/Overlay。 |
| `apps/web/src/ui/ConnectionPanel.tsx`（新增） | 联机大厅：服务器 URL + 房间 ID 输入、加入/返回。 |
| `apps/web/src/ui/*`（BoardView/PlayerPanel/StatusBar/GameResultOverlay） | 改用 `ReadyGameController`（state 非空），联机时隐藏“新对局”（房间生命周期归服务器）。 |
| `apps/web/src/App.tsx` | 顶栏三入口：本地·两人 / 本地·三人 / 联机·三人；联机 = 大厅 → 会话视图。 |
| `apps/web/src/styles.css` | 大厅/等待/断线卡片样式。 |
| `apps/server/src/client-session.test.ts`（新增） | 7 个客户端会话测试（见下）。 |
| `pnpm-lock.yaml`、`apps/web/package.json` | web 增加依赖 `@darkchess/server: workspace:*`。 |

## 测试（总计 129/129 通过，0 失败）

- Core：86/86（2P 51 零回归 + 3P 29 + session 15 + smoke 6 + serialization 18 按文件计）
- Server：25/25
  - room.test.ts：16/16（Stage 4-5，零回归）
  - ws.integration.test.ts：2/2（Stage 4-6，零回归）
  - **client-session.test.ts：7/7（新增，驱动浏览器同款 WebSocketGameSession）**：
    1. connect → 服务端分配身份 → 等待期 null → 满员开局广播一致 → submit → 权威更新
    2. 非当前玩家提交 → notCurrentPlayer 拒绝且状态不变
    3. 伪造 playerId 信封 → 按连接身份处理（拒绝/接受均验证）
    4. 三人同房 + 第四人拒绝（roomClosed）
    5. 服务器 forfeit → eliminated(timeout) 事件 → 淘汰者提交 playerEliminated
    6. 两次超时 → 三会话同收 timeout 淘汰 → `{won, winner:null, winnerPlayerId:'C'}` → 32 子保留
    7. 重连：令牌恢复原 playerId + 最新状态；已淘汰者重连后提交仍被拒
    8. 完整三人随机对局（固定种子，真实 WebSocket，三会话）：每步三方状态一致直至正常终局

## 验证矩阵

- typecheck：core ✅ server ✅ web ✅
- web 生产构建 ✅（172.72 kB JS——客户端会话已入包）
- 真实服务器 smoke ✅（tsx 启动 + HTTP 多房间状态端点）
- 浏览器实体未启动：按本阶段 Windows 稳定性约束不启动浏览器进程；三人浏览器流程的
  验证方式 = 三个 WebSocketGameSession 实例（与浏览器完全相同的代码路径）经真实 WebSocket
  驱动完整对局（见 client-session 测试 7/7）。

## 已知限制与遗留（P2/P3）

- P2：联机 UI 无渲染自动化测试（与项目现状一致，typecheck + 会话层测试覆盖逻辑）；
  单浏览器联机时以“当前回合玩家”名义操作（真三人需三浏览器，热座共享屏幕场景语义一致）。
- P3：①权威状态帧包含未翻棋子身份（冻结的单一公共状态信任模型——UI 层统一 `?`，
  引入 per-player 投影被冻结规则明确禁止）；②重连令牌存 localStorage（无数据库约束下的
  刷新重连方案）；③vitest worker 退出时的原生栈噪音依旧（退出码 0）。

---

# UI 信息架构落地 + 局域网联机访问（Phase 1–4）— COMPLETE

## Phase 1 UI 骨架
- App 重写为「壳页面 + 沉浸式对局页」两层：壳 = 首页/联机/设置（共享底部导航），
  对局页（本地/联机）**不渲染底部导航**，经 Header「← 返回」退出。
- 新页面：`HomePage`（本地·两人/本地·三人入口卡 + 联机大入口 + 快速开始 Future 占位）、
  `OnlinePage`（联机·两人【暂未开放，IA 预留】/ 联机·三人【立即进入】+ 返回当前房间）、
  `SettingsPage`（游戏/声音/外观/联机/关于五分组）、`RoomPage`（ConnectionPanel 正式化：
  表单 + 座位列表 ●/○ + 等待 x/3 + 重连令牌提示 + 退出房间）。
- `RoomPage`→`GamePage` 由 App 自动切换（权威状态到达即开局）；联机会话提升到 App 层。

## Phase 2 GamePage 分区
- 新 `GameHeader`（← 返回 / 模式·房间 / 联机连接状态 或 ⚙设置）；`StatusBar` 删除，
  信息拆入 Header 与新 `game-status` 区（当前行动方+阵营 / 手数 / 上下文人话提示）。
- 新 `Toast`（顶部短暂提示，3.2s 自动消失，不阻塞）。
- **联机座位门控**：本浏览器只操作自己的座位（ownTurn 门控，非本回合棋盘不亮子、
  点击提示「还没轮到你行动」）——与服务器权威校验一致，多设备各管一座。
- 修复：`useLocalGame`「新对局」此前只清选中、从未重建会话 → epoch 重建。
- 终局 Overlay 增加「返回」出口；联机隐藏「新对局」。

## Phase 3 局域网
- `vite.config.ts`：`server.host = true` / `preview.host = true`（监听全部接口，零依赖升级）。
- WS 地址自动适配：`defaultServerUrl()` = 页面协议(ws/wss) + 当前 hostname + :8787
  （手机访问 http://<PC-IP>:5173 → 自动得 ws://<PC-IP>:8787；localhost 同理）；无协议输入自动补全。
- **真实验证**：`lan.test.ts` 从本机非内部 IPv4（192.168.x.x）发起 WebSocket 入座成功（server 26/26）；
  Vite dev 以 LAN IP 实测 HTTP 200（localhost 与 192.168.154.1 均 200，Network 地址正常打印）。
- **未做**：真实手机第二设备测试（本环境无第二设备）；Windows 防火墙首次运行 Node 需人工放行（文档提醒）。

## Phase 4 人话化与设置
- `friendly.ts`：协议码→用户文案（notCurrentPlayer→还没轮到你行动、playerEliminated→你已被淘汰…、
  timeout→⏱ 玩家X操作超时…）；拒绝统一走 Toast；原始 code 仅 console.debug（调试面板后续接入）。
- 设置实装：音效开关+音量（`soundManager.configure`，localStorage 持久化 `settings.ts`）、
  默认服务器地址（喂给房间页表单）；其余分组灰显占位。
- `DrawProgress` 阈值改由 `modeDrawThresholds(modeId)` 读取（2P 顶层常量 / 3P 新增
  `DRAW_THRESHOLDS` 配置导出——core 仅导出、零逻辑改动），2P/3P 均正确。

## 验证
- core 86/86 · server 26/26（+1 LAN 实测） · web typecheck/build 通过 · 三包 typecheck 通过
- 进程零残留（tasklist node.exe = 0）；无 schtasks/无限循环/自动重试

---

# 联机回归诊断与修复：RoomPage 永不发起 WebSocket 连接

## 根因（确定性，非猜测）

UI IA 阶段把联机会话提升到 App 层后，`useOnlineGame` 在 App 挂载时即存在，其初始
`online.status = 'connecting'` 在**未请求任何连接**时同样是 'connecting'；而 RoomPage
以 `online.status !== 'closed'` 判定"连接中"→ **加入房间表单分支永不渲染** →
`onJoin`/`setOnlineConn` 永不触发 → App 始终传入 NULL_CONNECTION →
`useOnlineGame` effect 命中空连接守卫提前返回 → `new WebSocket()` 从未执行。
与全部现象吻合：无 WS 请求、players: []、反复退出重进无效（空闲态未被重置）。
LAN/防火墙/协议/Server 均无关（TcpTestSucceeded 与 HTTP 200 与此一致）。

## 最小修复（仅 web，3 文件）

1. `useGame.ts`：`OnlineStatus` 增加 `'idle'`；初始状态按 `connection.url` 区分
   idle/connecting；effect 空连接分支重置为 idle（同引用防重渲染循环）。
2. `RoomPage.tsx`：`connecting` 排除 `'idle'` → 空闲时渲染表单。
3. `GameHeader.tsx`：idle 显示"未连接"（防御，正常不可达）。

## 验证

- 修复后链路实测（真实 server，端口 8787，LAN 绑定）：3 客户端依次 connect →
  分配 A/B/C → 0/3→3/3 → status playing → 三方权威状态一致 → 翻棋广播 turn=1 → 换手 B。
- core 86/86 · server 26/26 · web typecheck/build 通过 · 无进程/端口残留。

## 待人工验收清单（用户 LAN 环境）

1. `pnpm --filter @darkchess/server dev` + `pnpm --filter @darkchess/web dev`
2. PC 浏览器 A/B/C（或手机）访问 http://192.168.1.157:5173 → 联机 → 联机·三人
3. **确认房间页出现"加入房间"表单（本次修复的判定点）**
4. 填 ws://192.168.1.157:8787 + room-1 → 加入 → 座位列表 1/3→2/3→3/3 → 自动开局
5. Network 面板应出现 `ws://192.168.1.157:8787/?room=room-1`

---

# 收尾阶段：联机 2P + 个性化结算 + 淘汰观战（阶段 1–4）— COMPLETE

## 阶段 1 联机 2P
- 读码确认：Room 的 `seatIds` 本就完全参数化（join 顺序分配座位、`seats.size === seatIds.length`
  自动开局），GameSession/GameEngine 模式无关；唯一缺口是桥接层将单一 mode 写死给所有房间。
- 最小修改：`startDarkChessServer` 增加可选 `extraModes`（key/mode/seatIds），连接 URL
  `?mode=<key>` 选择模式；房间内部键 `<modeKey>:<roomId>`（同名 roomId 的 2P/3P 互不干扰）；
  `getRoom(roomId, modeKey?)`；默认行为不变（无 ?mode= → 默认模式，既有测试零改动）。
- 客户端：`connectWebSocketGameSession` 增加 `mode` URL 参数；`OnlineConnection.mode`；
  App 按 conn.mode 选择 GameMode；OnlinePage 启用联机·两人；RoomPage 按 mode 显示 x/2 或 x/3。
- 新测试 `two-player-online.test.ts`（7 个，真实 WebSocket）：满员开局/座位分配/双方状态一致、
  第三人拒绝、模式路由互不干扰、完整随机对局至终局（含翻棋/移动/吃子/回合/胜负）、
  非当前+伪造 playerId 拒绝、超时判负（未绑阵营 → winner:null + winnerPlayerId）、断线重连。

## 阶段 2 个性化结算
- `GameResultOverlay` 增加 `viewerId`（联机 = 本机 playerId；本地热座保持中性展示）：
  胜利（获胜阵营：X）／失败（获胜者：玩家X（阵营））／已淘汰（本局获胜者：…）三态；
  玩家判据与阵营判据、eliminated 与 active 全部区分。

## 阶段 3 淘汰观战
- 淘汰玩家收到选择卡「你已被淘汰：[继续观战] [退出房间]」；继续观战仅本地 UI 态——
  保持 WebSocket 连接、playerId、eliminated，持续接收广播，结算页显示“已淘汰”；
  退出房间走既有 exitOnline（服务端断线保留座位机制不变）。
- 淘汰玩家点击棋盘提示「你已经被淘汰，无法继续行动」（区别于未轮到的提示）。

## 阶段 4 清理与封存
- 清理：删除弃用 `.mode-switch` CSS；README 更新为实际状态（四种玩法/入口/命令/封存声明）；
  无 TODO/FIXME/调试遗留（console.debug 为有意保留的协议调试输出）。
- 最终回归：core 86/86 · server 33/33 · web typecheck+build ✅ · 双模式入口 smoke ✅ · 进程零残留。

---

# Stage 8–13：v1.0 收尾（token 生命周期 / 计时 / 审计 / 封存）

## Stage 8 reconnect token / Room 生命周期（根因与修复）

**根因**（读码定位，确定性）：①token 的 localStorage key 不含模式 → 3P/2P 同名 roomId 共用；
②terminal 后 token 永不删除；③桥接 rejoin 跨模式扫描全部房间且不检查房间状态；
④finished 房间永久占据 (mode, roomId) 槽位，阻塞新游戏。

**修复**：
- 客户端：token key 改为 `darkchess:ws:${url}:${mode}:${roomId}`；**收到 terminal 广播即删除
  token**（凭证 = 恢复进行中对局，对局结束使命即完成）；RoomPage 令牌提示按 (url, mode, roomId)。
- 服务端：rejoin 仅在连接所属模式的房间中查找（跨模式 token → invalidToken）；
  **显式新 join 命中 finished 房间时以全新对局替换同名房间**（旧结果此前已广播送达，旧 token 失效）；
  room.join 不再自行发送 rejected（由桥接在最终失败时发送，消除替换竞态）。

测试 `lifecycle.test.ts`（7 个）：进行中断线重连回归（2P/3P）、terminal→同名房间全新对局、
旧 token 失效（invalidToken）、3P token × 2P 流程隔离、2P token × 3P 流程隔离、
败/胜方各自重开、terminal 不阻塞新 Room。

## Stage 9 好友房可选计时（服务端权威）

- 策略：房间创建时经 URL `?timer=<秒>`（钳制 5–600s）固定；off/缺省 = 不限时；后加入者沿用房间策略。
  本地模式永不计时。概念预留 friend/matchmaking 模式区分（v1 仅实现 friend）。
- 服务端：`turnDeadline` 跟踪；所有 state 广播（含开局/行动/判负/rejoin）统一携带
  `turnRemainingSec`（null=不限时）；超时判负复用既有 armTimer→forfeit，绝不自动走子。
- 客户端：显示用倒计时（mm:ss，≤10s 红色脉动），每条权威广播重新同步——服务器仍是唯一权威。
- RoomPage 新增计时选择（不限时/30/60/90/120）；GamePage 仅在计时房显示倒计时。
- 测试 `timer.test.ts`（4 个）：不限时无计时字段、计时房倒计时/行动重置、服务端超时判负
  （终局广播 remaining=null）、重连后剩余时间正确（计时继续、不因断线清除）。

## Stage 10 LAN 验收

真实入口 smoke（双模式 main.ts、8787、LAN IP 198.18.0.1）：2P 计时房开局 ✅、3P 房开局 ✅、
HTTP 房间总览 ✅、干净退出零进程残留 ✅。2P/3P 完整随机对局、重连、token 隔离、超时由
真实 WebSocket 测试套件覆盖（two-player-online / client-session / lifecycle / timer）。
**未做**：物理多设备（手机/平板）人工流程——需用户按 docs 清单执行一次。

## Stage 11 安全/架构审计

- 权威性：grep 证实 web 端无 forfeit/winner/eliminated/currentPlayer 写入路径；
  client session 不暴露 forfeit；一切状态变更仅经 server validateCommand → engine.apply。
- playerId：服务端以连接绑定身份处理指令，消息体声明的身份一律无效（已有测试覆盖伪造场景）。
- **隐藏信息模型（v1.0 事实声明）**：server 向所有客户端广播完整 GameState，UI 层统一以 `?`
  渲染未翻棋子——即“UI 隐藏，非网络层隐藏”。对 LAN/好友房可接受；**v1.0 明确不提供公网
  陌生人匹配**；未来 v2 若实现公网匹配，必须先拆分 PublicGameState / PrivatePlayerState。

## Stage 12 UI 收尾

设置项全部真实生效（音效开关/音量→soundManager、默认服务器→房间页表单）或诚实标“预留”
（游戏/外观，灰显不可点）；页面流程无死路（对局页 Header 返回、结算 Overlay 返回、
淘汰选择卡、房间页退出）；计时 UI 按策略显示；联机状态（idle/connecting/waiting/playing/
disconnected/terminal）均有明确用户可见表达。

## Stage 13 最终矩阵

本地 2P/3P ✅ · 好友联机 2P/3P ✅ · 好友房不限时/可选计时 ✅ · 服务端 timeout ✅ · timeout UI ✅ ·
reconnect ✅ · terminal token 隔离 ✅ · 新局不恢复旧局 ✅ · 淘汰 ✅ · 淘汰观战 ✅ · 个性化结算 ✅ ·
LAN 2P/3P ✅（自动化等价验证）。陌生人匹配 = ❌ v1.0 不实现（Future v2）。
