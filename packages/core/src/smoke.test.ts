import { describe, expect, it } from 'vitest';
import { createEngine } from './engine/game-engine';
import { createDarkChess4x8Mode } from './modes/dark-chess-4x8';
import { mulberry32 } from './rng/rng';

describe('dark-chess-4x8 冒烟测试', () => {
  it('初始状态：32 枚棋子、全部背面、A 先手、阵营未定', () => {
    const mode = createDarkChess4x8Mode();
    const state = mode.createInitialState(1);

    expect(state.board.width).toBe(4);
    expect(state.board.height).toBe(8);
    expect(state.board.cells).toHaveLength(32);
    expect(state.board.cells.every((c) => c.piece !== null && !c.piece.revealed)).toBe(true);
    expect(state.currentPlayerId).toBe('A');
    expect(state.players.every((p) => p.factionId === null)).toBe(true);
    expect(state.status.kind).toBe('inProgress');
  });

  it('第一枚翻出的棋子颜色决定 A 的阵营，且翻棋者不获得棋子归属', () => {
    const mode = createDarkChess4x8Mode();
    const engine = createEngine(mode);
    const state0 = mode.createInitialState(2);

    const reveals = engine.getLegalActions(state0).filter((a) => a.kind === 'reveal');
    const firstReveal = reveals[0]!;
    const pieceBefore = state0.board.cells.find(
      (c) => c.x === firstReveal.position.x && c.y === firstReveal.position.y,
    )!.piece!;

    const state = engine.apply(state0, firstReveal);

    const a = state.players.find((p) => p.id === 'A')!;
    const b = state.players.find((p) => p.id === 'B')!;
    expect(a.factionId).toBe(mode.factionForColor(pieceBefore.color));
    expect(b.factionId).not.toBeNull();
    expect(b.factionId).not.toBe(a.factionId);
  });

  it('随机对局：进行中状态始终存在合法动作，且能正常推进到终局', () => {
    const mode = createDarkChess4x8Mode();
    const engine = createEngine(mode);
    const rng = mulberry32(999);
    let state = mode.createInitialState(42);
    let moves = 0;

    while (state.status.kind === 'inProgress' && moves < 500) {
      const actions = engine.getLegalActions(state);
      expect(actions.length).toBeGreaterThan(0);
      const action = actions[rng.nextInt(actions.length)]!;
      state = engine.apply(state, action);
      moves += 1;
      expect(state.turnNumber).toBe(moves);
    }

    expect(state.status.kind).not.toBe('inProgress');
    expect(moves).toBeGreaterThan(0);
  });
});
