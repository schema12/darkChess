import { describe, expect, it } from 'vitest';
import { createEngine } from '../engine/game-engine';
import type { GameState } from '../model/game-state';
import {
  deserializeGameState,
  serializeGameState,
} from '../model/serialization';
import type { GameMode } from '../modes/game-mode';
import { createDarkChess3p4x8Mode } from '../modes/dark-chess-3p-4x8';
import {
  FACTION_BLACK_NORMAL,
  FACTION_RED_NORMAL,
  FACTION_ROYALS,
  factionOfPiece,
  NO_CAPTURE_DRAW_THRESHOLD,
  piecePool,
} from '../modes/dark-chess-3p-4x8/config';
import { createRuleSet } from '../modes/dark-chess-3p-4x8/rules';
import { mulberry32 } from '../rng/rng';
import { build3pState } from './helpers';
import type { FactionId, PlayerId } from '../model/ids';
import type { Player } from '../model/player';

const mode = createDarkChess3p4x8Mode();
const engine = createEngine(mode);

/** 构造三名玩家分别绑定指定阵营的状态。 */
function boundPlayers(a: FactionId, b: FactionId, c: FactionId): Player[] {
  return [
    { id: 'A', name: null, factionId: a },
    { id: 'B', name: null, factionId: b },
    { id: 'C', name: null, factionId: c },
  ];
}

const ALL_BOUND = () => boundPlayers(FACTION_ROYALS, FACTION_RED_NORMAL, FACTION_BLACK_NORMAL);

function factionOf(state: { players: readonly Player[] }, id: PlayerId): FactionId | null {
  return state.players.find((p) => p.id === id)?.factionId ?? null;
}

function isEliminated(state: { players: readonly Player[] }, id: PlayerId): boolean {
  return state.players.find((p) => p.id === id)?.eliminated === true;
}

function moveTargets(state: GameState, from: { x: number; y: number }): string[] {
  const result: string[] = [];
  for (const a of engine.getLegalActions(state)) {
    if (a.kind === 'move' && a.from.x === from.x && a.from.y === from.y) {
      result.push(`${a.to.x},${a.to.y}`);
    }
  }
  return result;
}

describe('三人玩法：阵营定义与归属', () => {
  it('32 枚棋子按 12/10/10 归入三个阵营', () => {
    const counts = new Map<string, number>([
      [FACTION_ROYALS, 0],
      [FACTION_RED_NORMAL, 0],
      [FACTION_BLACK_NORMAL, 0],
    ]);
    for (const spec of piecePool) {
      const f = factionOfPiece(spec);
      counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    expect(counts.get(FACTION_ROYALS)).toBe(12);
    expect(counts.get(FACTION_RED_NORMAL)).toBe(10);
    expect(counts.get(FACTION_BLACK_NORMAL)).toBe(10);
  });

  it('factionOfPiece：KING/PAWN 不论颜色同属将帅兵卒阵营，其余按颜色划分', () => {
    expect(factionOfPiece({ type: 'KING', color: 'RED' })).toBe(FACTION_ROYALS);
    expect(factionOfPiece({ type: 'KING', color: 'BLACK' })).toBe(FACTION_ROYALS);
    expect(factionOfPiece({ type: 'PAWN', color: 'RED' })).toBe(FACTION_ROYALS);
    expect(factionOfPiece({ type: 'PAWN', color: 'BLACK' })).toBe(FACTION_ROYALS);
    for (const type of ['ADVISOR', 'ELEPHANT', 'ROOK', 'KNIGHT', 'CANNON'] as const) {
      expect(factionOfPiece({ type, color: 'RED' })).toBe(FACTION_RED_NORMAL);
      expect(factionOfPiece({ type, color: 'BLACK' })).toBe(FACTION_BLACK_NORMAL);
    }
  });
});

describe('三人玩法：阵营分配', () => {
  it('初始三名玩家均无阵营', () => {
    const state = mode.createInitialState(1);
    expect(state.players.map((p) => p.factionId)).toEqual([null, null, null]);
  });

  it('分配序列：占据/跳过已占阵营/自动分配第三阵营/确定后不再改变', () => {
    // 未翻棋子：F1 红兵、F1 黑卒、F1 红将、F1 黑将、F1 红卒、F2 红车、F3 黑车。
    let state = build3pState([
      { x: 0, y: 0, type: 'PAWN', color: 'RED', revealed: false }, // F1
      { x: 1, y: 0, type: 'PAWN', color: 'BLACK', revealed: false }, // F1
      { x: 2, y: 0, type: 'KING', color: 'RED', revealed: false }, // F1
      { x: 3, y: 0, type: 'KING', color: 'BLACK', revealed: false }, // F1
      { x: 0, y: 1, type: 'PAWN', color: 'RED', revealed: false }, // F1
      { x: 1, y: 1, type: 'ROOK', color: 'RED', revealed: false }, // F2
      { x: 2, y: 1, type: 'ROOK', color: 'BLACK', revealed: false }, // F3
    ]);

    // A 翻到将帅兵卒棋子 → 获得 Faction 1。
    state = engine.apply(state, { kind: 'reveal', position: { x: 0, y: 0 } });
    expect(factionOf(state, 'A')).toBe(FACTION_ROYALS);
    expect(factionOf(state, 'B')).toBeNull();
    expect(factionOf(state, 'C')).toBeNull();

    // B 翻到 Faction 1 的另一枚棋子（黑卒）→ 已被占据，B 保持未分配。
    state = engine.apply(state, { kind: 'reveal', position: { x: 1, y: 0 } });
    expect(factionOf(state, 'B')).toBeNull();

    // C 翻到 Faction 1（红将）→ 同样不获得。
    state = engine.apply(state, { kind: 'reveal', position: { x: 2, y: 0 } });
    expect(factionOf(state, 'C')).toBeNull();

    // A（已绑定）翻棋 → 阵营不变。
    state = engine.apply(state, { kind: 'reveal', position: { x: 3, y: 0 } });
    expect(factionOf(state, 'A')).toBe(FACTION_ROYALS);

    // B 再次翻到 Faction 1（红卒）→ 仍保持未分配（可多次发生）。
    state = engine.apply(state, { kind: 'reveal', position: { x: 0, y: 1 } });
    expect(factionOf(state, 'B')).toBeNull();

    // C 翻到 Faction 2（红车）→ C 获得 Faction 2；
    // 同时只剩 B 未分配且只剩 Faction 3 未占据 → B 自动获得 Faction 3。
    state = engine.apply(state, { kind: 'reveal', position: { x: 1, y: 1 } });
    expect(factionOf(state, 'C')).toBe(FACTION_RED_NORMAL);
    expect(factionOf(state, 'B')).toBe(FACTION_BLACK_NORMAL);
    expect(factionOf(state, 'A')).toBe(FACTION_ROYALS);

    // 三阵营全部确定后继续翻棋 → 不再改变任何阵营。
    state = engine.apply(state, { kind: 'reveal', position: { x: 2, y: 1 } });
    expect(factionOf(state, 'A')).toBe(FACTION_ROYALS);
    expect(factionOf(state, 'B')).toBe(FACTION_BLACK_NORMAL);
    expect(factionOf(state, 'C')).toBe(FACTION_RED_NORMAL);
  });
});

describe('三人玩法：敌我关系与吃子', () => {
  it('吃子矩阵 7×7 全量（三人表：兵吃全部、王不吃兵、士不吃王、象不吃王/士）', () => {
    const ALL = ['KING', 'ADVISOR', 'ELEPHANT', 'ROOK', 'KNIGHT', 'CANNON', 'PAWN'] as const;
    const CAN: Record<string, readonly string[]> = {
      KING: ['ADVISOR', 'ELEPHANT', 'ROOK', 'KNIGHT', 'CANNON', 'KING'],
      ADVISOR: ['ELEPHANT', 'ROOK', 'KNIGHT', 'CANNON', 'PAWN', 'ADVISOR'],
      ELEPHANT: ['ROOK', 'KNIGHT', 'CANNON', 'PAWN', 'ELEPHANT'],
      ROOK: ALL,
      KNIGHT: ALL,
      CANNON: ALL,
      PAWN: ALL, // 三人特例：兵/卒可吃任意类型的敌方棋子
    };
    for (const attacker of ALL) {
      for (const defender of ALL) {
        expect(mode.ruleSet.capture.canCapture(attacker, defender)).toBe(
          CAN[attacker]!.includes(defender),
        );
      }
    }
  });

  it('Faction 1 内部：红将不能吃黑将、红兵不能吃黑卒（颜色不同阵营相同）', () => {
    const state = build3pState(
      [
        { x: 1, y: 1, type: 'KING', color: 'RED', revealed: true },
        { x: 2, y: 1, type: 'KING', color: 'BLACK', revealed: true },
        { x: 1, y: 5, type: 'PAWN', color: 'RED', revealed: true },
        { x: 2, y: 5, type: 'PAWN', color: 'BLACK', revealed: true },
      ],
      { currentPlayer: 'A', players: ALL_BOUND() },
    );
    expect(mode.factionOf({ type: 'KING', color: 'BLACK' })).toBe(FACTION_ROYALS);
    expect(moveTargets(state, { x: 1, y: 1 })).not.toContain('2,1');
    expect(moveTargets(state, { x: 1, y: 5 })).not.toContain('2,5');
  });

  it('不同阵营可以互吃：F2 红车可吃 F3 黑车（颜色相同阵营不同）', () => {
    const state = build3pState(
      [
        { x: 1, y: 1, type: 'ROOK', color: 'RED', revealed: true }, // F2
        { x: 2, y: 1, type: 'ROOK', color: 'BLACK', revealed: true }, // F3
      ],
      { currentPlayer: 'B', players: ALL_BOUND() },
    );
    expect(moveTargets(state, { x: 1, y: 1 })).toContain('2,1');
  });

  it('Faction 2 / Faction 3 内部互不可吃', () => {
    const state = build3pState(
      [
        { x: 1, y: 1, type: 'ROOK', color: 'RED', revealed: true }, // F2
        { x: 2, y: 1, type: 'KNIGHT', color: 'RED', revealed: true }, // F2
        { x: 1, y: 5, type: 'KNIGHT', color: 'BLACK', revealed: true }, // F3
        { x: 2, y: 5, type: 'CANNON', color: 'BLACK', revealed: true }, // F3
      ],
      { currentPlayer: 'B', players: ALL_BOUND() },
    );
    expect(moveTargets(state, { x: 1, y: 1 })).not.toContain('2,1');
    expect(moveTargets(state, { x: 1, y: 5 })).not.toContain('2,5');
  });

  it('兵/卒可吃任意类型的敌方阵营棋子（实际吃子执行）', () => {
    let state = build3pState(
      [
        { x: 1, y: 1, type: 'PAWN', color: 'RED', revealed: true }, // A(F1)
        { x: 2, y: 1, type: 'ROOK', color: 'RED', revealed: true }, // B(F2)
        { x: 0, y: 7, type: 'KNIGHT', color: 'BLACK', revealed: true }, // C(F3)
      ],
      { currentPlayer: 'A', players: ALL_BOUND() },
    );
    state = engine.apply(state, { kind: 'move', from: { x: 1, y: 1 }, to: { x: 2, y: 1 } });
    // 吃子成功；F2 盘上无子 → 游戏继续（F1/F3 仍在），B 随后被僵局淘汰退出。
    expect(state.board.cells.find((c) => c.x === 2 && c.y === 1)?.piece?.type).toBe('PAWN');
    expect(state.status.kind).toBe('inProgress');
    expect(isEliminated(state, 'B')).toBe(true);
    expect(state.currentPlayerId).toBe('C');

    // 能力表：兵对将/士/象/车/马/炮/兵全部可吃（类型层面）。
    for (const type of ['KING', 'ADVISOR', 'ELEPHANT', 'ROOK', 'KNIGHT', 'CANNON', 'PAWN'] as const) {
      expect(mode.ruleSet.capture.canCapture('PAWN', type)).toBe(true);
    }
  });

  it('将不能吃兵/卒；士不能吃将；象不能吃将/士（类型能力表）', () => {
    expect(mode.ruleSet.capture.canCapture('KING', 'PAWN')).toBe(false);
    expect(mode.ruleSet.capture.canCapture('ADVISOR', 'KING')).toBe(false);
    expect(mode.ruleSet.capture.canCapture('ELEPHANT', 'KING')).toBe(false);
    expect(mode.ruleSet.capture.canCapture('ELEPHANT', 'ADVISOR')).toBe(false);
  });

  it('炮：隔一子吃（炮架可为未翻棋子）、无炮架不吃、隔两子不吃', () => {
    // 炮架为未翻棋子，目标为敌方（F3 黑车）。
    let state = build3pState(
      [
        { x: 1, y: 1, type: 'CANNON', color: 'RED', revealed: true }, // F2
        { x: 1, y: 3, type: 'PAWN', color: 'BLACK', revealed: false }, // 炮架（未翻）
        { x: 1, y: 4, type: 'ROOK', color: 'BLACK', revealed: true }, // F3 目标
      ],
      { currentPlayer: 'B', players: ALL_BOUND() },
    );
    let targets = moveTargets(state, { x: 1, y: 1 });
    expect(targets).toContain('1,4');
    expect(targets).not.toContain('1,3');

    // 无炮架不吃相邻敌子。
    state = build3pState(
      [
        { x: 1, y: 1, type: 'CANNON', color: 'RED', revealed: true },
        { x: 1, y: 2, type: 'ROOK', color: 'BLACK', revealed: true },
      ],
      { currentPlayer: 'B', players: ALL_BOUND() },
    );
    targets = moveTargets(state, { x: 1, y: 1 });
    expect(targets).not.toContain('1,2');

    // 隔两子不吃（第 3 枚是目标位）。
    state = build3pState(
      [
        { x: 1, y: 1, type: 'CANNON', color: 'RED', revealed: true },
        { x: 1, y: 2, type: 'KNIGHT', color: 'BLACK', revealed: true },
        { x: 1, y: 3, type: 'ADVISOR', color: 'BLACK', revealed: true },
        { x: 1, y: 4, type: 'ROOK', color: 'BLACK', revealed: true },
      ],
      { currentPlayer: 'B', players: ALL_BOUND() },
    );
    targets = moveTargets(state, { x: 1, y: 1 });
    expect(targets).not.toContain('1,4');
  });

  it('马：对角一格、无蹩马腿，可吃对角敌方', () => {
    const state = build3pState(
      [
        { x: 1, y: 1, type: 'KNIGHT', color: 'RED', revealed: true }, // F2
        { x: 2, y: 2, type: 'ROOK', color: 'BLACK', revealed: true }, // F3
      ],
      { currentPlayer: 'B', players: ALL_BOUND() },
    );
    const targets = moveTargets(state, { x: 1, y: 1 });
    expect(targets).toContain('2,2');
    expect(targets).toContain('0,0');
    expect(targets).not.toContain('2,1');
  });
});

describe('三人玩法：强制翻棋', () => {
  it('情况 A：无合法移动/吃子且仍有隐藏棋子 → 只能 Reveal', () => {
    const state = build3pState(
      [
        // A(F1) 唯一已翻棋子被两个未翻棋子挡死（未翻格不可作为移动目标）。
        { x: 0, y: 0, type: 'PAWN', color: 'RED', revealed: true },
        { x: 1, y: 0, type: 'PAWN', color: 'BLACK', revealed: false },
        { x: 0, y: 1, type: 'ROOK', color: 'BLACK', revealed: false },
        { x: 3, y: 7, type: 'CANNON', color: 'RED', revealed: false },
      ],
      { currentPlayer: 'A', players: ALL_BOUND() },
    );
    const actions = engine.getLegalActions(state);
    expect(actions).toHaveLength(3);
    expect(actions.every((a) => a.kind === 'reveal')).toBe(true);

    // 强制翻棋可行：翻棋算一个 Action，执行后换手。
    const next = engine.apply(state, { kind: 'reveal', position: { x: 3, y: 7 } });
    expect(next.turnNumber).toBe(1);
    expect(next.currentPlayerId).toBe('B');
  });

  it('情况 B：有隐藏棋子但也存在合法移动 → 移动与翻棋并存（不强制翻）', () => {
    const state = build3pState(
      [
        { x: 1, y: 1, type: 'PAWN', color: 'RED', revealed: true }, // (1,2) 为空，可移动
        { x: 3, y: 7, type: 'CANNON', color: 'RED', revealed: false },
      ],
      { currentPlayer: 'A', players: ALL_BOUND() },
    );
    const actions = engine.getLegalActions(state);
    expect(actions.some((a) => a.kind === 'move' && a.to.x === 1 && a.to.y === 2)).toBe(true);
    expect(actions.some((a) => a.kind === 'reveal')).toBe(true);
  });
});

describe('三人玩法：僵局与淘汰', () => {
  it('全员翻开后当前玩家无合法动作 → 判负退出，剩余玩家继续，不指定“唯一对手”获胜', () => {
    // F1 无盘上棋子；C 走一步后轮到 A（F1），A 无任何合法动作。
    let state = build3pState(
      [
        { x: 3, y: 7, type: 'ROOK', color: 'RED', revealed: true }, // B(F2)
        { x: 0, y: 0, type: 'KNIGHT', color: 'BLACK', revealed: true }, // C(F3)
      ],
      { currentPlayer: 'C', players: ALL_BOUND() },
    );
    state = engine.apply(state, { kind: 'move', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } });

    expect(isEliminated(state, 'A')).toBe(true);
    expect(state.status.kind).toBe('inProgress'); // 不是“某对手获胜”
    expect(state.currentPlayerId).toBe('B');

    // 淘汰者不再获得回合：B 行动后轮到 C（跳过 A）。
    state = engine.apply(state, { kind: 'move', from: { x: 3, y: 7 }, to: { x: 3, y: 6 } });
    expect(state.currentPlayerId).toBe('C');

    // C 行动后轮回 B。
    state = engine.apply(state, { kind: 'move', from: { x: 1, y: 1 }, to: { x: 2, y: 2 } });
    expect(state.currentPlayerId).toBe('B');
    expect(state.status.kind).toBe('inProgress');
  });

  it('连续淘汰：棋子保留在棋盘，仅剩一名未淘汰玩家时立即获胜', () => {
    // B(F2) 象在角落被 C 的两枚士堵死（士不能被象吃）；C 的马负责走一步传递回合。
    // A(F1) 无盘上棋子：C 走完后 A、B 相继僵局淘汰；B 的象必须保留在棋盘上；
    // 只剩 C 未淘汰 → C 立即获胜（玩家判据，winnerPlayerId 表达）。
    const before = build3pState(
      [
        { x: 0, y: 0, type: 'ELEPHANT', color: 'RED', revealed: true }, // B(F2)
        { x: 1, y: 0, type: 'ADVISOR', color: 'BLACK', revealed: true }, // C(F3)
        { x: 0, y: 1, type: 'ADVISOR', color: 'BLACK', revealed: true }, // C(F3)
        { x: 3, y: 7, type: 'KNIGHT', color: 'BLACK', revealed: true }, // C(F3)
      ],
      { currentPlayer: 'C', players: ALL_BOUND() },
    );
    const state = engine.apply(before, {
      kind: 'move',
      from: { x: 3, y: 7 },
      to: { x: 2, y: 6 },
    });

    expect(isEliminated(state, 'A')).toBe(true);
    expect(isEliminated(state, 'B')).toBe(true);
    expect(isEliminated(state, 'C')).toBe(false);
    expect(state.currentPlayerId).toBe('C');

    // 棋盘没有因为淘汰而减少任何棋子：B 的象仍在原位置、仍属 F2。
    expect(state.board.cells.filter((c) => c.piece !== null)).toHaveLength(4);
    expect(state.board.cells.find((c) => c.x === 0 && c.y === 0)?.piece).toMatchObject({
      type: 'ELEPHANT',
      color: 'RED',
    });
    expect(
      state.board.cells.filter(
        (c) => c.piece !== null && mode.factionOf(c.piece) === FACTION_RED_NORMAL,
      ),
    ).toHaveLength(1);

    expect(state.status).toEqual({
      kind: 'won',
      winner: FACTION_BLACK_NORMAL,
      winnerPlayerId: 'C',
    });
  });

  it('淘汰序列化一致性：currentPlayerId 指向已淘汰玩家的状态无法通过校验', () => {
    let state = build3pState(
      [
        { x: 3, y: 7, type: 'ROOK', color: 'RED', revealed: false }, // F2
        { x: 0, y: 0, type: 'ADVISOR', color: 'BLACK', revealed: false }, // F3
      ],
      { currentPlayer: 'A' },
    );
    state = engine.forfeit(state, 'A');
    // 引擎保证判负后轮转不会落在已淘汰玩家身上。
    expect(state.currentPlayerId).toBe('B');
    expect(isEliminated(state, 'A')).toBe(true);
    expect(state.status.kind).toBe('inProgress');

    const tampered = JSON.parse(serializeGameState(state)) as { currentPlayerId: string };
    tampered.currentPlayerId = 'A';
    expect(() => deserializeGameState(JSON.stringify(tampered))).toThrow(/已淘汰/);
  });
});

describe('三人玩法：权威判负（forfeit / 超时）', () => {
  it('forfeit 只标记玩家淘汰：阵营棋子全部保留，且仍可被其他阵营正常捕获', () => {
    // A(F1) 有两枚兵在盘上；A 被权威判负（超时/认输语义），棋子必须保留，
    // 之后 B(F2) 用车越过空格吃掉其中一枚。
    let state = build3pState(
      [
        { x: 0, y: 0, type: 'PAWN', color: 'RED', revealed: true }, // A(F1)
        { x: 1, y: 0, type: 'PAWN', color: 'BLACK', revealed: true }, // A(F1)
        { x: 3, y: 0, type: 'ROOK', color: 'RED', revealed: true }, // B(F2)
        { x: 3, y: 7, type: 'KNIGHT', color: 'BLACK', revealed: true }, // C(F3)
      ],
      { currentPlayer: 'B', players: ALL_BOUND() },
    );
    state = engine.forfeit(state, 'A');

    expect(isEliminated(state, 'A')).toBe(true);
    expect(state.status.kind).toBe('inProgress');
    expect(state.board.cells.filter((c) => c.piece !== null)).toHaveLength(4); // 判负不触碰棋盘
    expect(state.currentPlayerId).toBe('B'); // 判负者不是当前玩家 → 行动权不变

    // B 车 (3,0)→(1,0)：吃掉已淘汰玩家 A 的黑兵。
    state = engine.apply(state, { kind: 'move', from: { x: 3, y: 0 }, to: { x: 1, y: 0 } });
    expect(state.board.cells.find((c) => c.x === 1 && c.y === 0)?.piece?.type).toBe('ROOK');
    expect(state.status.kind).toBe('inProgress');
  });

  it('forfeit 可淘汰尚未绑定阵营的玩家；回合永远跳过被淘汰者', () => {
    let state = build3pState(
      [
        { x: 3, y: 7, type: 'CANNON', color: 'RED', revealed: false }, // F2
        { x: 0, y: 0, type: 'ADVISOR', color: 'BLACK', revealed: false }, // F3
      ],
      { currentPlayer: 'A' }, // 三名玩家均未绑定阵营
    );
    state = engine.forfeit(state, 'A');

    expect(isEliminated(state, 'A')).toBe(true);
    expect(state.players.map((p) => p.factionId)).toEqual([null, null, null]);
    expect(state.currentPlayerId).toBe('B'); // 轮到下一位未淘汰玩家
    expect(state.status.kind).toBe('inProgress');

    // B 翻棋获得 F2；自动分配只考虑未淘汰玩家（A 已淘汰，不参与绑定）。
    state = engine.apply(state, { kind: 'reveal', position: { x: 3, y: 7 } });
    expect(state.currentPlayerId).toBe('C'); // 跳过已淘汰的 A
    expect(factionOf(state, 'B')).toBe(FACTION_RED_NORMAL);
    expect(factionOf(state, 'C')).toBeNull();
  });

  it('forfeit / 僵局淘汰不影响和棋计数与动作日志', () => {
    let state = build3pState(
      [
        { x: 3, y: 7, type: 'ROOK', color: 'RED', revealed: false }, // F2
        { x: 0, y: 0, type: 'ADVISOR', color: 'BLACK', revealed: false }, // F3
      ],
      { currentPlayer: 'A', noCaptureCount: 7 },
    );
    state = engine.forfeit(state, 'A');

    // 判负不是动作：不累计无吃子步数、不产生历史记录、不推进回合数。
    expect(state.noCaptureCount).toBe(7);
    expect(state.actionLog).toHaveLength(0);
    expect(state.turnNumber).toBe(0);
    expect(state.actionLog.length).toBe(state.turnNumber);
  });

  it('forfeit 非当前玩家（认输语义）时不改变行动权', () => {
    const state0 = build3pState(
      [
        { x: 3, y: 7, type: 'CANNON', color: 'RED', revealed: false }, // F2
        { x: 0, y: 0, type: 'ADVISOR', color: 'BLACK', revealed: false }, // F3
      ],
      { currentPlayer: 'B' },
    );
    const state = engine.forfeit(state0, 'A');
    expect(isEliminated(state, 'A')).toBe(true);
    expect(state.currentPlayerId).toBe('B');
  });

  it('连续 forfeit 两名玩家：最后一名未淘汰玩家立即获胜（棋子不被清除）', () => {
    let state = build3pState(
      [
        { x: 0, y: 0, type: 'PAWN', color: 'RED', revealed: true }, // A(F1)
        { x: 3, y: 0, type: 'ROOK', color: 'RED', revealed: true }, // B(F2)
        { x: 3, y: 7, type: 'KNIGHT', color: 'BLACK', revealed: true }, // C(F3)
      ],
      { currentPlayer: 'A', players: ALL_BOUND() },
    );
    state = engine.forfeit(state, 'A');
    expect(state.status.kind).toBe('inProgress');
    expect(state.currentPlayerId).toBe('B');

    state = engine.forfeit(state, 'B');
    expect(isEliminated(state, 'B')).toBe(true);
    expect(state.currentPlayerId).toBe('C');
    // 三枚棋子全部保留：胜负不以清除棋盘的方式表达。
    expect(state.board.cells.filter((c) => c.piece !== null)).toHaveLength(3);
    expect(state.status).toEqual({
      kind: 'won',
      winner: FACTION_BLACK_NORMAL,
      winnerPlayerId: 'C',
    });
  });

  it('forfeit 已淘汰/未知玩家或已结束对局时抛错', () => {
    let state = build3pState(
      [
        { x: 3, y: 7, type: 'ROOK', color: 'RED', revealed: false }, // F2
        { x: 0, y: 0, type: 'ADVISOR', color: 'BLACK', revealed: false }, // F3
      ],
      { currentPlayer: 'A' },
    );
    state = engine.forfeit(state, 'A');
    expect(state.status.kind).toBe('inProgress');
    expect(() => engine.forfeit(state, 'A')).toThrow(/已被淘汰/);
    expect(() => engine.forfeit(state, 'Z')).toThrow(/未知玩家/);

    const over = engine.forfeit(state, 'B'); // 只剩 C → C 立即获胜（未绑定阵营）
    expect(over.status).toEqual({ kind: 'won', winner: null, winnerPlayerId: 'C' });
    expect(() => engine.forfeit(over, 'C')).toThrow(/对局已结束/);
  });
});

describe('三人玩法：胜利', () => {
  const BATTLE = () =>
    build3pState(
      [
        { x: 0, y: 0, type: 'KING', color: 'RED', revealed: true }, // F1
        { x: 1, y: 0, type: 'ROOK', color: 'RED', revealed: true }, // F2
        { x: 2, y: 0, type: 'KNIGHT', color: 'BLACK', revealed: true }, // F3
      ],
      { currentPlayer: 'B', players: ALL_BOUND() },
    );

  it('三阵营都在时不终局；一个阵营被吃光后游戏继续（该阵营玩家随后被淘汰）', () => {
    const state = engine.apply(BATTLE(), {
      kind: 'move',
      from: { x: 1, y: 0 },
      to: { x: 2, y: 0 },
    });
    expect(state.status.kind).toBe('inProgress'); // F1/F2 仍在 → 不终局
    expect(isEliminated(state, 'C')).toBe(true); // F3 无子 → C 被淘汰
    expect(state.currentPlayerId).toBe('A');
  });

  it('只剩一个阵营 → 该阵营获胜（胜负只看棋盘剩余阵营）', () => {
    let state = engine.apply(BATTLE(), {
      kind: 'move',
      from: { x: 1, y: 0 },
      to: { x: 2, y: 0 },
    }); // 吃 F3 → C 淘汰 → 轮 A
    state = engine.apply(state, { kind: 'move', from: { x: 0, y: 0 }, to: { x: 1, y: 0 } }); // A 王走一步
    state = engine.apply(state, { kind: 'move', from: { x: 2, y: 0 }, to: { x: 1, y: 0 } }); // B 车吃 F1 王 → 只剩 F2
    expect(state.status).toEqual({ kind: 'won', winner: FACTION_RED_NORMAL });
  });
});

describe('三人玩法：和棋', () => {
  // A 兵 (1,1)↔(1,2)；C 马 (0,7)↔(1,6)；B 车在 cycle 模式 (3,0)↔(3,1)（6 步全局周期），
  // 在 wander 模式沿列游走 14 轮一个往返（42 步全局周期，避免重复局面先行触发）。
  const CAR_PATH: ReadonlyArray<readonly [number, number]> = [
    [3, 0], [3, 1], [3, 2], [3, 3], [3, 4], [3, 5], [3, 6], [3, 7],
    [3, 6], [3, 5], [3, 4], [3, 3], [3, 2], [3, 1], [3, 0],
  ];

  const CYCLE_STATE = () =>
    build3pState(
      [
        { x: 1, y: 1, type: 'PAWN', color: 'RED', revealed: true }, // A(F1)
        { x: 3, y: 0, type: 'ROOK', color: 'RED', revealed: true }, // B(F2)
        { x: 0, y: 7, type: 'KNIGHT', color: 'BLACK', revealed: true }, // C(F3)
      ],
      { currentPlayer: 'A', players: ALL_BOUND() },
    );

  function stepWith(
    eng: ReturnType<typeof createEngine>,
    state: GameState,
    i: number,
    mode: 'cycle' | 'wander',
  ): GameState {
    const turn = i % 3;
    const round = Math.floor(i / 3);
    const half = round % 2 === 0;
    if (turn === 0) {
      return eng.apply(state, {
        kind: 'move',
        from: half ? { x: 1, y: 1 } : { x: 1, y: 2 },
        to: half ? { x: 1, y: 2 } : { x: 1, y: 1 },
      });
    }
    if (turn === 1) {
      if (mode === 'cycle') {
        return eng.apply(state, {
          kind: 'move',
          from: half ? { x: 3, y: 0 } : { x: 3, y: 1 },
          to: half ? { x: 3, y: 1 } : { x: 3, y: 0 },
        });
      }
      const k = round % 14;
      return eng.apply(state, {
        kind: 'move',
        from: { x: CAR_PATH[k]![0], y: CAR_PATH[k]![1] },
        to: { x: CAR_PATH[k + 1]![0], y: CAR_PATH[k + 1]![1] },
      });
    }
    return eng.apply(state, {
      kind: 'move',
      from: half ? { x: 0, y: 7 } : { x: 1, y: 6 },
      to: half ? { x: 1, y: 6 } : { x: 0, y: 7 },
    });
  }

  function playUntilEnd(eng: ReturnType<typeof createEngine>, mode: 'cycle' | 'wander', cap: number) {
    let state = CYCLE_STATE();
    let i = 0;
    while (state.status.kind === 'inProgress' && i < cap) {
      state = stepWith(eng, state, i, mode);
      i += 1;
    }
    return { state, steps: i };
  }

  it('三方都存在时重复局面达到 5 次 → 和棋', () => {
    const { state, steps } = playUntilEnd(engine, 'cycle', 40);
    expect(state.status).toEqual({
      kind: 'drawn',
      reason: { kind: 'repetition', count: 5 },
    });
    expect(steps).toBeLessThanOrEqual(31); // 6 步全局周期，第 30 步第 5 次出现
  });

  it('连续无吃子达到 40 → 和棋（重复局面周期 42 步，不会先行触发）', () => {
    const { state } = playUntilEnd(engine, 'wander', 60);
    expect(state.status).toEqual({
      kind: 'drawn',
      reason: { kind: 'noCapture', threshold: NO_CAPTURE_DRAW_THRESHOLD },
    });
  });

  it('和棋阈值可配置（重复局面阈值改为 2）', () => {
    const variant: GameMode = { ...mode, ruleSet: createRuleSet({ repetitionThreshold: 2 }) };
    const variantEngine = createEngine(variant);
    const { state, steps } = playUntilEnd(variantEngine, 'cycle', 20);
    expect(steps).toBeLessThanOrEqual(12); // 6 步周期，第 12 步第 2 次出现
    expect(state.status).toEqual({ kind: 'drawn', reason: { kind: 'repetition', count: 2 } });
  });
});

describe('三人玩法：序列化', () => {
  it('引擎产生的任意状态可序列化往返一致（含淘汰字段）', () => {
    const rng = mulberry32(7);
    let state = mode.createInitialState(42);
    for (let i = 0; i < 150 && state.status.kind === 'inProgress'; i++) {
      const actions = engine.getLegalActions(state);
      state = engine.apply(state, actions[rng.nextInt(actions.length)]!);
      expect(deserializeGameState(serializeGameState(state))).toEqual(state);
    }
  });
});
