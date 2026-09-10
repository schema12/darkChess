# DarkChess 架构设计文档（Phase 1）

> 本文档对应需求《棋类游戏平台——第一阶段产品与技术需求说明》的 Phase 1：架构。
> 本阶段只做设计与骨架，不实现具体业务规则逻辑（移动/吃子/胜负/和棋的具体计算推迟到 Phase 2）。

---

## 1. 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 语言 | TypeScript（strict） | 规则引擎、可序列化状态、多玩法扩展都需要强类型约束 |
| 包管理 | pnpm + workspaces（monorepo） | 逻辑核心、Web 前端、未来服务端分离；复用核心包 |
| 游戏核心 | 纯 TypeScript 库 `@darkchess/core`，零 UI/零 DOM 依赖 | 规则与渲染完全解耦；可被 Web、AI、服务端、测试复用 |
| 前端 | React + Vite + TypeScript（`apps/web`） | Phase 4 实现 UI/动画；DOM/SVG 渲染网格棋盘足够 |
| 测试 | Vitest（`packages/core`） | Phase 3 对每种棋子与规则写单测 |
| 未来服务端 | Node + WebSocket（`apps/server`） | 阶段一明确不做，仅预留目录与接口边界 |

**关键约束：**
- 核心逻辑永远不 import React/DOM/浏览器 API。
- 核心包只依赖标准语言能力（以及可选的注入式随机源 `Rng`），不依赖任何第三方运行时库。
- 所有游戏逻辑与视觉素材完全解耦：棋盘、棋子、棋子背面、动画、音效全部通过资源层（`Assets`/`ResourceLoader`）加载。

---

## 2. 项目结构

```
DarkChess/
├── docs/
│   └── architecture.md                 # 本文档
├── packages/
│   └── core/                           # 纯逻辑核心（规则引擎 + 状态模型 + GameMode）
│       └── src/
│           ├── index.ts                # 公共导出
│           ├── model/                  # 数据模型（纯类型/接口）
│           │   ├── ids.ts
│           │   ├── piece.ts
│           │   ├── board.ts
│           │   ├── player.ts
│           │   ├── faction.ts
│           │   ├── action.ts
│           │   ├── game-state.ts
│           │   └── serialization.ts
│           ├── rules/                  # 规则引擎抽象（接口，Phase 2 实现）
│           │   ├── capture.ts
│           │   ├── movement.ts
│           │   ├── reveal.ts
│           │   ├── validator.ts
│           │   ├── win-condition.ts
│           │   ├── draw-condition.ts
│           │   ├── rule-set.ts
│           │   ├── turn.ts
│           │   ├── faction-binding.ts  # 阵营绑定规则（何时/如何确定玩家阵营）
│           │   └── stalemate.ts        # 僵局结算规则（当前玩家无动作时的处置）
│           ├── engine/                 # 通用引擎（与具体玩法无关）
│           │   └── game-engine.ts
│           ├── modes/                  # 具体玩法（每玩法一个目录）
│           │   ├── game-mode.ts        # GameMode 接口
│           │   ├── dark-chess-4x8/     # 玩法一：4×8 暗棋（两人）
│           │   │   ├── index.ts
│           │   │   ├── config.ts       # 棋盘尺寸、棋子池、阵营
│           │   │   └── rules.ts        # 吃子表、移动规则、胜负/和棋
│           │   └── dark-chess-3p-4x8/  # 玩法二：三人 4×8 暗棋
│           │       ├── index.ts
│           │       ├── config.ts       # 三阵营（按 type+color 判定）、棋子池
│           │       └── rules.ts        # 渐进阵营绑定、淘汰制僵局、兵吃全部
│           ├── rng/                    # 随机源抽象（可注入 seed，便于测试/回放）
│           └── session/                # 会话/协议层（多人化基础）
│               ├── command.ts          # 动作信封 + 权威校验/执行
│               └── game-session.ts     # GameSession 接口 + 本地（热座）会话
├── apps/
│   └── web/                            # React 前端（Phase 4 实现 UI）
│       ├── index.html
│       ├── vite.config.ts
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── assets/                 # 资源层：程序生成的 SVG 占位素材
│           │   ├── pieces/             # 棋子/棋子背面
│           │   ├── board/              # 棋盘
│           │   └── registry.ts         # 资源注册表（key -> loader）
│           ├── game/                   # 前端侧状态桥接（连接 core 与 React）
│           └── ui/                     # 展示组件（棋盘、棋子、提示）
├── packages/core/vitest.config.ts
├── tsconfig.base.json
├── pnpm-workspace.yaml
└── package.json
```

> 未来新增玩法：在 `packages/core/src/modes/` 下新增目录（如 `modes/three-player`），实现 `GameMode` 接口，**不复制整个项目**。
> 未来联网：新增 `apps/server`，复用 `@darkchess/core` 做权威状态与校验。

---

## 3. 核心领域模型

### 3.1 身份标识（id 抽象）

```ts
type ColorId  = string;   // 棋子自身颜色（墨色），当前为 "RED"/"BLACK"
type FactionId = string;  // 阵营/势力，当前与 ColorId 一一对应
type PlayerId  = string;  // 座位/玩家，当前为 "A"/"B"
type PieceId   = string;  // 棋子实例唯一 id
```

要点（对应需求二十三）：
- `ColorId` / `FactionId` / `PlayerId` 都是**不透明字符串**，不使用硬编码枚举，避免 `if (player === RED)` 散落全项目。
- 当前玩法中三者恰好一一对应，但模型把它们分开，未来支持：3 名玩家、多个阵营、玩家与阵营不完全一一对应、非红黑颜色。

### 3.2 棋子类型（抽象类型，稳定不变）

```ts
const PIECE_TYPES = ['KING','ADVISOR','ELEPHANT','ROOK','KNIGHT','CANNON','PAWN'] as const;
type PieceType = typeof PIECE_TYPES[number];
```

- “将”与“帅”是同一 `PieceType = 'KING'`，颜色不同；“兵”与“卒”同为 `'PAWN'`。
- 提供运行时数组（用于遍历、构建吃子表、生成棋子池）。

### 3.3 Piece（棋子）

```ts
interface Piece {
  readonly id: PieceId;
  readonly type: PieceType;
  readonly color: ColorId;     // 棋子自身的颜色，决定归属
  readonly revealed: boolean;  // 是否已翻开
}
```

归属规则（需求四/五）：**棋子归属永远由 `color` 决定，与谁执行翻棋无关**。归属推导为
`mode.factionForColor(piece.color)`，而不是“翻棋者”。

### 3.4 Board（棋盘）

```ts
interface Position { readonly x: number; readonly y: number }

interface Cell {
  readonly x: number;
  readonly y: number;
  readonly piece: Piece | null;   // null = 空格
}

interface Board {
  readonly width: number;         // 当前玩法 width = 4
  readonly height: number;        // 当前玩法 height = 8
  readonly cells: readonly Cell[]; // 行优先，长度 = width*height
}
```

- `4` 和 `8` 只出现在玩法配置 `modes/dark-chess-4x8/config.ts` 中，不进通用引擎。
- 所有边界判断（是否越界）由规则引擎统一处理，不向玩家单独提示。

### 3.5 Player / Faction（玩家 / 阵营）

```ts
interface Player {
  readonly id: PlayerId;
  readonly factionId: FactionId | null; // 第一枚翻棋前为 null
}

interface Faction {
  readonly id: FactionId;
  readonly displayName: string;
  readonly colors: readonly ColorId[];  // 归属该阵营的棋子颜色；当前各一色
}
```

- 开局 `Player A`/`Player B` 的 `factionId` 都是 `null`。
- 第一步 `Player A` 必须翻棋；第一枚翻出的棋子颜色 → `mode.factionForColor(color)` → 固定为 `Player A` 的阵营，另一方为 `Player B` 阵营，之后整局不变。

### 3.6 Action（动作）

```ts
type GameAction =
  | { readonly kind: 'reveal'; readonly position: Position }   // 翻棋
  | { readonly kind: 'move';   readonly from: Position; readonly to: Position }; // 移动/吃子
```

- “吃子”不是独立动作：`move` 落到敌方棋子格 = 吃子（由引擎根据目标格推导，并做吃子合法性校验）。
- 每个玩家回合只执行一个 `GameAction`，执行完即换手。

### 3.7 GameState（可序列化游戏状态）

```ts
interface GameState {
  readonly schemaVersion: number;        // 序列化版本
  readonly modeId: string;               // 当前 GameMode
  readonly board: Board;
  readonly players: readonly Player[];
  readonly currentPlayerId: PlayerId;
  readonly turnNumber: number;           // 已进行动作数
  readonly noCaptureCount: number;       // 连续未吃子动作数
  readonly status: GameStatus;
  readonly repetitionKey: string;        // 用于重复局面判定的状态指纹（不含计数类字段）
  readonly actionLog: readonly MoveRecord[]; // 回放用动作日志（含历史快照指纹）
}
```

- 纯数据、**不可变（immutable）**：每次动作生成新的 `GameState`，便于 AI、保存/加载、回放、联网同步、调试。
- 满足需求十六列出的全部字段（模式、棋盘、棋子类型/颜色/翻面、玩家、阵营、轮次、未吃子计数、胜负、和棋、历史）。

### 3.8 GameStatus / 胜负 / 和棋

```ts
type GameStatus =
  | { readonly kind: 'inProgress' }
  | { readonly kind: 'won';   readonly winner: FactionId }
  | { readonly kind: 'drawn'; readonly reason: DrawReason };

type DrawReason =
  | { readonly kind: 'noCapture';  readonly threshold: number }
  | { readonly kind: 'repetition'; readonly count: number };
```

- 和棋不写成散落的 if/else，而是独立的 `DrawCondition` 列表（见 4.5）。
- 阈值（`noCaptureDrawThreshold`、重复次数）作为配置项，不永久写死。

---

## 4. 规则引擎抽象

所有“玩法相关”的规则都放进 `RuleSet`（由具体 `GameMode` 提供）；通用引擎只调度。

### 4.1 CaptureRule（吃子）

```ts
interface CaptureRule {
  canCapture(attacker: PieceType, defender: PieceType): boolean;
}
```

- 吃子只与 `(攻击方类型, 被攻击方类型)` 有关，与颜色无关；是否能吃**己方**由上层统一禁止。
- 当前玩法用一张**数据驱动的吃子表**实现（`CaptureMatrix`），表数据写在 `modes/dark-chess-4x8/config.ts`，**不在引擎里写 `if 车 / if 炮`**。
- 炮的“恰好隔一子”是**移动合法性**约束（见 4.2），吃子能力上炮可吃全部类型。

### 4.2 MovementRule（移动）

```ts
interface MovementRule {
  legalDestinations(state: GameState, from: Position): readonly Position[];
}
```

按抽象移动形态组织，而非按红黑/具体棋子名：

| 形态 | 适用（当前玩法） | 说明 |
|---|---|---|
| `orthogonalStep` | 将/帅、士/仕、象/相、兵/卒 | 上下左右 1 格 |
| `diagonalStep` | 马 | 左上/右上/左下/右下 1 格（无“蹩马腿”） |
| `slide` | 车 | 上下左右任意格，不可越任何棋子 |
| `cannonSlide` | 炮 | 移动同车不可越子；吃子须与目标**恰好隔 1 子**，且不可“打空炮” |

共同限制（统一在 `MoveValidator` 层强制，避免散落）：
- 不可越界、不可进入己方格、不可移动到未翻开格；
- 落到敌方格时必须 `CaptureRule.canCapture` 通过，否则不可作为目标。

### 4.3 RevealRule（翻棋）

```ts
interface RevealRule {
  legalReveals(state: GameState): readonly Position[]; // 通常 = 所有未翻开格
}
```

- 只要有未翻开棋子即可翻；翻棋即一步，翻完换手。
- “无任何合法移动/吃子且仍有未翻开棋”时强制翻棋：由引擎在 `getLegalActions` 中按 `RevealRule` 兜底，而不是写死在 UI。

### 4.4 MoveValidator（合法性校验）

```ts
type MoveValidation =
  | { readonly legal: true }
  | { readonly legal: false; readonly reason: string };

interface MoveValidator {
  validate(state: GameState, action: GameAction): MoveValidation;
}
```

- 统一出口，返回结构化原因，UI 只展示 `reason`，规则修正只在引擎内进行（对应需求 Phase 5）。

### 4.5 WinCondition / DrawCondition（胜负 / 和棋）

```ts
interface WinCondition {
  evaluate(state: GameState): FactionId | null;  // 返回胜方或 null
}

interface DrawCondition {
  evaluate(state: GameState): DrawReason | null; // 返回和棋原因或 null
}
```

当前玩法：
- **胜负**：某阵营所有棋子被吃光 → 该阵营判负，另一阵营获胜（无“将军/将死/照面”）。
- **无合法行动**：无移动、无吃子、且无未翻棋子 → 当前玩家判负。
- **和棋（基础）**：
  1. `NoCaptureDrawCondition`：连续未吃子计数达到可配置阈值。
  2. `RepetitionDrawCondition`：基于 `repetitionKey` 计数，达到可配置次数判和。
- 不把“只剩车车就判和”这类残局性质硬编码进来（对应需求十五.3）。

### 4.6 TurnManager（回合）

```ts
interface TurnManager {
  currentPlayer(state: GameState): PlayerId;
  next(state: GameState, action: GameAction): GameState; // 换手 + 更新计数
}
```

- 每动作 = 一回合；动作后换手。
- 维护 `turnNumber` 与 `noCaptureCount`（仅吃子重置计数）。

### 4.7 FactionBindingRule（阵营绑定）

```ts
interface RevealEvent {
  readonly revealerId: PlayerId;
  readonly revealedColor: ColorId;
  readonly revealedType: PieceType;  // 阵营可由 (type, color) 共同决定
}

interface FactionBindingRule {
  apply(state: GameState, event: RevealEvent | null): readonly Player[];
}
```

- 引擎在每次动作应用后调用（非翻棋动作 `event` 为 null），用返回值替换玩家列表；
- 何时绑定、把哪个阵营绑给谁完全由玩法决定（当前二人玩法：所有玩家阵营未定时的首次翻棋 → 翻棋者得翻出颜色的阵营、其余玩家得另一阵营）；
- 开局即固定阵营的玩法使用 `createStaticFactionBinding()`（恒等）；
- 引擎不假设玩家数、阵营数及其对应关系（三人玩法接入点之一）。

### 4.8 StalemateRule（僵局结算）

```ts
type StalemateResolution =
  | { readonly kind: 'ended'; readonly status: GameStatus }      // 就此终局
  | { readonly kind: 'continue'; readonly state: GameState };    // 处置后继续（引擎重新结算）

interface StalemateRule {
  resolve(state: GameState): StalemateResolution | null;  // null 表示不在此结算
}
```

- 当胜负条件与和棋条件都未命中、且当前玩家没有任何合法动作时，引擎调用它做最终结算；
- “无动作如何处置”属于玩法规则（二人玩法：对手获胜；其他玩法可判和或另有安排），引擎不做假设（三人玩法接入点之一）；
- 终局结算顺序固定为：胜负条件 → 和棋条件 → 僵局规则。

---

## 5. GameMode 抽象

```ts
interface GameMode {
  readonly id: string;
  readonly name: string;
  readonly boardConfig: { readonly width: number; readonly height: number };
  readonly factions: readonly Faction[];
  readonly piecePool: readonly PieceSpec[];        // 32 个固定棋子规格
  readonly ruleSet: RuleSet;
  factionOf(piece: FactionPieceRef): FactionId;  // 棋子（类型+颜色）-> 阵营
  createInitialState(seed?: number): GameState;    // 随机打乱 + 全背面 + 玩家（人数由玩法定）
  validateAction(state: GameState, action: GameAction): MoveValidation;
  applyAction(state: GameState, action: GameAction): GameState;
}
```

- 棋盘尺寸、棋子数量、初始布局、玩家人数、阵营关系、移动/吃子/胜负/和棋规则**全部属于具体 GameMode**。
- 未来 `GameMode` 下挂 `Mode1 / Mode2 / Mode3 ...`，新玩法只需新增一个 mode 目录并实现接口。

## 6. GameEngine（通用引擎）

```ts
interface GameEngine {
  getLegalActions(state: GameState): readonly GameAction[];
  validate(state: GameState, action: GameAction): MoveValidation;
  apply(state: GameState, action: GameAction): GameState; // 校验通过才应用
}
```

- 引擎只做：取得当前玩家 → 汇集合法动作（翻棋/移动/吃子）→ 校验 → 应用 → 结算（胜负/和棋/僵局）→ 换手；阵营绑定同样经 RuleSet 委托给玩法。
- 引擎**不感知** 4×8、红黑、棋子名、玩法细节；全部通过 `mode.ruleSet` 与 `mode` 接口获得。
- 状态为纯函数式演进：`next = engine.apply(state, action)`，输入输出皆可序列化。

---

## 7. 前后端职责

### 7.1 `packages/core`（纯逻辑，唯一权威规则）
- 领域模型、规则引擎、GameMode、GameState、胜负/和棋判定、序列化、随机源。
- 被前端、未来 AI、未来服务端复用；绝不依赖渲染。

### 7.2 `apps/web`（纯展示 + 输入）
- 渲染 `GameState`，把用户点击转成带发送者的指令（`CommandEnvelope`），经 `GameSession.submit` 提交给权威方执行，状态通过 `subscribe` 从权威方获得（单机下为本地会话，同步生效）。engine 仅用于合法动作的视图推导（高亮提示），不再是状态的最终执行者。
- 动画（翻棋/移动/吃子）、回合/胜负提示均为展示层，**不包含规则逻辑**。
- 资源层 `assets/registry.ts`：以 `key`（如 `piece:KING:RED`、`piece-back:RED`、`board`）→ 加载器的方式提供素材；当前用程序生成的 SVG 占位，后续换最终素材不改核心逻辑。

### 7.3 `apps/server`（阶段一不做，仅预留边界）
- 未来做房间/联网时，服务端持有权威 `GameState`，对每条客户端消息调用 `applyCommand`（含发送者与回合校验），客户端只提交 `CommandEnvelope`，经同一 `GameSession` 接口接入（见第 12 节）。

---

## 8. 序列化与状态指纹

- `GameState` 全部字段为 JSON 可序列化，`serialize(state): string` / `parse(json): GameState` 在 `model/serialization.ts`。
- **完整状态哈希**（完整性/调试）与**重复局面指纹 `repetitionKey`** 分离：
  - `repetitionKey` 只包含：所有格子的 `(type, color, revealed)`、当前玩家、玩家阵营绑定。
  - **不包含** `turnNumber`、`noCaptureCount`（这些是计数类字段，若纳入会导致“完全相同的局面”永远不相等，破坏重复局面判定）。
- 回放用 `actionLog` 记录动作序列与每步后的 `repetitionKey`（轻量），按需可扩展为完整快照。

---

## 9. 随机源抽象

```ts
interface Rng { nextInt(maxExclusive: number): number } // 可注入 seed
```

- 开局打乱 32 棋子的随机源可注入，保证测试/回放可复现，同时满足“随机打乱”需求。
- 默认用 `Math.random` 实现，测试用 seeded 实现。

---

## 10. 规则歧义的确认结果（已记录，Phase 2 已实现）

> 遵循需求二十二，以下歧义已向用户确认后再写入核心规则：

1. **同类型敌方棋子可互吃**：将↔帅（KING）、仕↔士（ADVISOR）、相↔象（ELEPHANT）都可互吃。
   吃子表据此补全（见 `modes/dark-chess-4x8/rules.ts`）。
2. **“回合”口径**：按需求五“每一步都算一个完整回合”，未吃子计数以“单方每走一步”计，仅吃子归零。
3. **重复局面判和次数**：完全相同局面出现 **5 次** 判和（可配置项 `REPETITION_DRAW_THRESHOLD = 5`）。
4. **未吃子判和阈值**：默认 40（可配置 `NO_CAPTURE_DRAW_THRESHOLD = 40`，后续可调）。

---

## 11. 阶段计划

- **Phase 1（本阶段）**：本文档 + 项目骨架 + 领域模型/接口类型（已含 `modes/dark-chess-4x8` 的配置占位与棋子池）。不实现规则计算。
- **Phase 2**：实现移动/吃子/翻棋/回合/胜负/和棋 + 玩法一完整规则（待歧义确认后）。
- **Phase 3**：Vitest 覆盖每种棋子与边界情况（未翻不可移动、不可吃己方、车不越子、炮恰隔一子、翻棋归属、翻棋耗回合、无行动判负等）。
- **Phase 4**：React UI + SVG 占位素材 + 动画 + 提示。
- **Phase 5**：试玩，规则问题优先修引擎。

> 阶段一明确不开发：联网匹配、房间、账号、支付、广告、排行榜、聊天、社交、商城、成就、其他未描述玩法。

---

## 12. 会话 / 协议层（多人化第一阶段）

为从单机演进到多人对局，在规则引擎之上新增一层**与传输无关**的会话/协议抽象（`src/session/`）。它不引入任何具体玩法规则，只改变“谁执行引擎”的拓扑：客户端提交动作，权威方校验并执行。

### 12.1 CommandEnvelope（动作信封）

```ts
interface CommandEnvelope {
  readonly playerId: PlayerId;  // 提交者（座位）身份
  readonly action: GameAction;  // 规则层动作本身
}
```

- `GameAction` 保持纯规则语义（翻棋/移动），不含发送者；“谁提交的”用信封包装；
- 序号、时间戳等传输层字段留待真正联网时由传输层扩展，不在此预设。

### 12.2 权威校验与执行

```ts
validateCommand(engine, state, command): CommandValidation;  // 纯校验，不改状态
applyCommand(engine, state, command): GameState;             // 校验通过才应用，否则抛错
```

- 拒绝顺序：对局已结束（`gameOver`）→ 提交者不存在（`unknownPlayer`）→ 未轮到提交者（`notCurrentPlayer`）→ 动作不合法（`illegalAction`）；
- 发送者校验先于动作校验，不向未授权提交者泄露规则细节；
- 未来 `apps/server` 的每个房间持有 engine，对每条客户端消息调用 `applyCommand`，失败时把结构化 code/reason 回传客户端。

### 12.3 GameSession（会话接口）

```ts
interface GameSession {
  getState(): GameState;
  submit(command: CommandEnvelope): CommandOutcome;   // accepted(state) | rejected(code, reason)
  subscribe(listener): Unsubscribe;                   // 接收权威状态更新
}
```

- `createLocalSession(mode, { seed?, initialState? })`：本地会话（单机热座 / loopback 传输），会话自身即权威执行方，submit 同步生效；
- 前端 `useGame` 已改为经由会话提交动作，engine 仅用于合法动作的视图推导（高亮）；
- 未来联网：以 WebSocket 实现同一 `GameSession` 接口（submit 走网络、subscribe 收权威状态），UI 代码无需改动。

### 12.4 尚未包含（后续阶段）

mode registry、房间/账号、断线重连、传输层序号与确认。

---

## 13. 玩法二：三人 4×8 暗棋（`modes/dark-chess-3p-4x8`）

三人玩法完全通过既有扩展点接入，引擎零改动。规则要点与实现映射：

| 规则 | 实现位置 |
|---|---|
| 三阵营（将帅兵卒 12 枚 / 红普通 10 枚 / 黑普通 10 枚），阵营由 `(type, color)` 共同判定 | `config.ts` 的 `factions` + `factionOfPiece`（`GameMode.factionOf`） |
| 翻到未占据阵营即获得；翻到已占阵营保持未分配；剩一未分配玩家自动获得最后阵营 | `rules.ts` 的 `createProgressiveFactionBinding`（RuleSet.factionBinding） |
| 兵/卒可吃任意类型敌方；王不吃兵；士不吃王；象不吃王/士；同阵营永不互吃 | `rules.ts` 吃子表（敌我由阵营过滤，类型表仅表达能力） |
| 移动/吃子形态与两人玩法一致 | 复用 `orthogonalStep/diagonalStep/slide/cannonSlide` 工厂 |
| 无合法走/吃但仍有未翻棋子 → 只能翻棋 | 引擎 `getLegalActions`：未绑定玩家与已绑定玩家统一只暴露翻棋 + 己方棋子动作 |
| 全员翻开后无合法动作 → 当前玩家判负退出，剩余玩家继续 | `rules.ts` 的 `createEliminateCurrentPlayerStalemate`（RuleSet.stalemate 返回 `continue`） |
| **淘汰 = 仅标记玩家 `eliminated`**：其阵营棋子全部保留在棋盘原位置（玩家淘汰 ≠ 阵营棋子消失），可被其他阵营正常捕获 | `Player.eliminated?`；`rules/turn.ts` 的 `nextActivePlayerId` 跳过已淘汰玩家 |
| 超时/认输判负：权威判负入口（服务端计时器/认输处理调用，客户端不得自行修改淘汰状态） | `GameEngine.forfeit(state, playerId)`；session 层 `GameSession.forfeit(playerId)` |
| 两名玩家被淘汰后，最后一名未淘汰玩家立即获胜（以玩家为判据；尚未绑定阵营时以 `status.winnerPlayerId` 表达） | `createLastActivePlayerWinCondition`（WinCondition 返回 `WinOutcome`：faction / player 双判据） |
| 胜负 = 棋盘只剩一个阵营（与玩家是否仍持子无关） | 复用 `createEliminationWinCondition`（N 阵营通用） |
| 和棋：重复局面 5 次 / 无吃子 40 步，阈值可配置 | 复用两个 DrawCondition；`createRuleSet(options)` 暴露阈值 |

序列化：`Player.eliminated` 为可选字段（旧两人存档兼容），纳入 `repetitionKey` 指纹；schemaVersion 不变。
Web：`App` 提供两人/三人切换；所有玩家看到相同棋盘，未翻棋子统一显示背面（无任何归属提示）。
