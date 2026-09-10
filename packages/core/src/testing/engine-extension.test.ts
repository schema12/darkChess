import { describe, expect, it } from 'vitest';
import { createEngine } from '../engine/game-engine';
import type { GameMode } from '../modes/game-mode';
import { createDarkChess4x8Mode } from '../modes/dark-chess-4x8';
import { factionForColor, NO_CAPTURE_DRAW_THRESHOLD } from '../modes/dark-chess-4x8/config';
import { createStaticFactionBinding } from '../rules/faction-binding';
import type { FactionBindingRule, RevealEvent } from '../rules/faction-binding';
import type { RuleSet } from '../rules/rule-set';
import type { StalemateRule } from '../rules/stalemate';
import { buildState } from './helpers';

const baseMode = createDarkChess4x8Mode();
const baseEngine = createEngine(baseMode);

/** 在基准玩法之上替换部分 RuleSet，构造测试用变体玩法（不新增具体玩法）。 */
function variantMode(overrides: Partial<RuleSet>): GameMode {
  return { ...baseMode, ruleSet: { ...baseMode.ruleSet, ...overrides } };
}

/** 与 cases.ts「无合法移动判负」同款的僵局构造：B 走一步后 A 无任何合法动作。 */
const STALEMATE_STATE = () =>
  buildState(
    [
      { x: 0, y: 0, type: 'KING', color: 'RED', revealed: true },
      { x: 1, y: 0, type: 'PAWN', color: 'BLACK', revealed: true },
      { x: 0, y: 1, type: 'PAWN', color: 'BLACK', revealed: true },
      { x: 3, y: 7, type: 'PAWN', color: 'BLACK', revealed: true },
    ],
    { currentPlayer: 'B' },
  );
const TRAP_MOVE = { kind: 'move' as const, from: { x: 3, y: 7 }, to: { x: 3, y: 6 } };

describe('RuleSet 扩展点：阵营绑定（FactionBindingRule）', () => {
  it('引擎在动作应用后调用绑定规则并采用其结果（可替换默认绑定）', () => {
    const calls: Array<{ event: RevealEvent | null; playersAfter: number }> = [];
    const binding: FactionBindingRule = {
      apply(state, event) {
        calls.push({ event, playersAfter: state.players.length });
        if (!event) return state.players;
        if (state.players.some((pl) => pl.factionId !== null)) return state.players;
        // 变体规则：只绑定翻棋者（与默认二人规则“双方都绑定”不同）。
        return state.players.map((pl) =>
          pl.id === event.revealerId
            ? { ...pl, factionId: factionForColor(event.revealedColor) }
            : pl,
        );
      },
    };
    const mode = variantMode({ factionBinding: binding });
    const engine = createEngine(mode);

    const state0 = mode.createInitialState(1);
    const reveal = engine.getLegalActions(state0).find((a) => a.kind === 'reveal')!;
    const revealedPiece = state0.board.cells.find(
      (c) => c.x === reveal.position.x && c.y === reveal.position.y,
    )!.piece!;
    const state1 = engine.apply(state0, reveal);

    expect(calls).toEqual([
      {
        event: {
          revealerId: 'A',
          revealedColor: revealedPiece.color,
          revealedType: revealedPiece.type,
        },
        playersAfter: 2,
      },
    ]);
    // 采用变体结果：只有翻棋者被绑定（默认规则下双方都会绑定）。
    expect(state1.players.find((p) => p.id === 'A')!.factionId).not.toBeNull();
    expect(state1.players.find((p) => p.id === 'B')!.factionId).toBeNull();
  });

  it('非翻棋动作以 event=null 调用绑定规则；恒等返回则玩家不变', () => {
    const events: Array<RevealEvent | null> = [];
    const binding: FactionBindingRule = {
      apply(state, event) {
        events.push(event);
        return state.players;
      },
    };
    const mode = variantMode({ factionBinding: binding });
    const engine = createEngine(mode);

    const state0 = buildState(
      [
        { x: 1, y: 1, type: 'ROOK', color: 'RED', revealed: true },
        { x: 2, y: 1, type: 'PAWN', color: 'BLACK', revealed: true },
        { x: 3, y: 7, type: 'PAWN', color: 'BLACK', revealed: true },
      ],
      { currentPlayer: 'A' },
    );
    const state1 = engine.apply(state0, { kind: 'move', from: { x: 1, y: 1 }, to: { x: 2, y: 1 } });

    expect(events).toEqual([null]);
    expect(state1.players).toEqual(state0.players);
  });

  it('createStaticFactionBinding：开局固定阵营的玩法不会被翻棋重新绑定', () => {
    const mode = variantMode({ factionBinding: createStaticFactionBinding() });
    const engine = createEngine(mode);

    const state0 = mode.createInitialState(1);
    const reveal = engine.getLegalActions(state0).find((a) => a.kind === 'reveal')!;
    const state1 = engine.apply(state0, reveal);
    expect(state1.players.every((p) => p.factionId === null)).toBe(true);

    // 对照：默认玩法下同一动作会绑定双方阵营。
    const baseState1 = baseEngine.apply(baseMode.createInitialState(1), reveal);
    expect(baseState1.players.every((p) => p.factionId !== null)).toBe(true);
  });
});

describe('RuleSet 扩展点：僵局结算（StalemateRule）', () => {
  it('默认规则（二人玩法）回归：当前玩家无合法动作 → 对手获胜', () => {
    const s1 = baseEngine.apply(STALEMATE_STATE(), TRAP_MOVE);
    expect(s1.status).toEqual({ kind: 'won', winner: 'BLACK' });
  });

  it('引擎采用玩法提供的僵局规则（变体：判和而不是判负）', () => {
    const stalemate: StalemateRule = {
      resolve() {
        return {
          kind: 'ended',
          status: {
            kind: 'drawn',
            reason: { kind: 'noCapture', threshold: NO_CAPTURE_DRAW_THRESHOLD },
          },
        };
      },
    };
    const mode = variantMode({ stalemate });
    const s1 = createEngine(mode).apply(STALEMATE_STATE(), TRAP_MOVE);
    expect(s1.status).toEqual({
      kind: 'drawn',
      reason: { kind: 'noCapture', threshold: NO_CAPTURE_DRAW_THRESHOLD },
    });
  });

  it('僵局规则返回 null 时对局保持进行中（结算权完全在玩法）', () => {
    const mode = variantMode({ stalemate: { resolve: () => null } });
    const engine = createEngine(mode);
    const s1 = engine.apply(STALEMATE_STATE(), TRAP_MOVE);
    expect(s1.status).toEqual({ kind: 'inProgress' });
    expect(engine.getLegalActions(s1)).toHaveLength(0);
  });

  it('结算顺序回归：和棋条件先于僵局规则', () => {
    // 无吃子计数达阈值、且走子后对手恰好无合法动作：应按和棋结算而非判负。
    const state = () =>
      buildState(
        [
          { x: 0, y: 0, type: 'KING', color: 'RED', revealed: true },
          { x: 1, y: 0, type: 'PAWN', color: 'BLACK', revealed: true },
          { x: 0, y: 1, type: 'PAWN', color: 'BLACK', revealed: true },
          { x: 3, y: 7, type: 'PAWN', color: 'BLACK', revealed: true },
        ],
        { currentPlayer: 'B', noCaptureCount: NO_CAPTURE_DRAW_THRESHOLD - 1 },
      );
    const s1 = baseEngine.apply(state(), TRAP_MOVE);
    expect(s1.status).toEqual({
      kind: 'drawn',
      reason: { kind: 'noCapture', threshold: NO_CAPTURE_DRAW_THRESHOLD },
    });
  });
});
