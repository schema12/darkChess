# DarkChess

可扩展的棋类游戏平台。第一阶段实现“4×8 暗棋/翻棋”玩法，架构为未来多种玩法（不同棋盘尺寸、多人、多阵营、多规则）预留扩展。

- 设计文档：`docs/architecture.md`
- 逻辑核心：`packages/core`（纯 TypeScript，与渲染解耦）
- Web 前端：`apps/web`（React + Vite，Phase 4 实现 UI）

## 开发

```bash
pnpm install
pnpm typecheck   # 类型检查全部包
pnpm test        # 运行 core 的 Vitest 测试
pnpm build       # 构建全部包
```

## 阶段

- Phase 1：架构 + 骨架（当前）
- Phase 2：核心规则
- Phase 3：规则测试
- Phase 4：游戏界面
- Phase 5：试玩与修正
