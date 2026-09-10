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
