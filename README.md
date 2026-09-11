# DarkChess

可扩展的棋类游戏平台。当前已实现 4×8 暗棋/翻棋的**本地与联机**玩法：

| 玩法 | 入口 |
|---|---|
| 本地 2P / 本地 3P | Web 首页 → 本地游戏（热座轮流） |
| 联机 2P / 联机 3P | Web 首页 → 联机 → 选择模式 → 房间（服务器权威） |

- 设计文档：`docs/architecture.md`（含三人规则 §13、会话/协议层 §12）
- 阶段报告：`docs/multiplayer-rollout.md`
- 逻辑核心：`packages/core`（纯 TypeScript，零 DOM/第三方运行时依赖）
- 权威服务器：`apps/server`（WebSocket，房间/重连/超时判负，`pnpm --filter @darkchess/server dev`，默认 ws://localhost:8787）
- Web 前端：`apps/web`（React + Vite；`pnpm --filter @darkchess/web dev`，已开启局域网监听，手机可直接访问 `http://<PC-IP>:5173`）

## 开发

```bash
pnpm install
pnpm typecheck   # 类型检查全部包
pnpm test        # 运行 core + server 的 Vitest 测试
pnpm build       # 构建全部包
```

## 状态

功能已封存（本地 2P/3P、联机 2P/3P、断线重连、超时判负、淘汰观战、个性化结算）。
仅修复明确 Bug，不再新增功能。
