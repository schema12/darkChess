import { describe, expect, it } from 'vitest';
import { createEngine } from './engine/game-engine';
import { createDarkChess4x8Mode } from './modes/dark-chess-4x8';
import { NO_CAPTURE_DRAW_THRESHOLD } from './modes/dark-chess-4x8/config';
import { mulberry32 } from './rng/rng';
import type { GameState } from './model/game-state';
import {
  createJsonSerializer,
  deserializeGameState,
  serializeGameState,
  validateGameState,
} from './model/serialization';
import { buildState } from './testing/helpers';

const mode = createDarkChess4x8Mode();
const engine = createEngine(mode);
const serializer = createJsonSerializer();

function roundTrip(state: GameState): GameState {
  return serializer.parse(serializer.serialize(state));
}

/** 用固定随机动作推进若干步（动作随机但可复现）。 */
function play(state: GameState, steps: number): GameState {
  const rng = mulberry32(2024);
  let s = state;
  for (let i = 0; i < steps && s.status.kind === 'inProgress'; i++) {
    const actions = engine.getLegalActions(s);
    s = engine.apply(s, actions[rng.nextInt(actions.length)]!);
  }
  return s;
}

/** 序列化后篡改字段再转回 JSON（用于构造非法存档）。 */
function tamper(state: GameState, mutate: (obj: any) => void): string {
  const obj: any = JSON.parse(serializer.serialize(state));
  mutate(obj);
  return JSON.stringify(obj);
}

describe('GameState 序列化/反序列化', () => {
  describe('往返一致性', () => {
    it('初始状态往返后完全一致，且序列化输出可复现', () => {
      const s0 = mode.createInitialState(1);
      const restored = roundTrip(s0);
      expect(restored).toEqual(s0);
      expect(serializer.serialize(restored)).toBe(serializer.serialize(s0));
    });

    it('中局状态往返后：棋盘/回合/阶段/翻棋/历史全部一致', () => {
      const state = play(mode.createInitialState(7), 12);
      expect(state.status.kind).toBe('inProgress');
      expect(state.actionLog.length).toBeGreaterThan(0);

      const restored = roundTrip(state);
      // 棋盘状态一致
      expect(restored.board).toEqual(state.board);
      for (let i = 0; i < state.board.cells.length; i++) {
        expect(restored.board.cells[i]?.piece?.type).toBe(state.board.cells[i]?.piece?.type);
        expect(restored.board.cells[i]?.piece?.color).toBe(state.board.cells[i]?.piece?.color);
        // 已翻棋信息一致
        expect(restored.board.cells[i]?.piece?.revealed).toBe(
          state.board.cells[i]?.piece?.revealed,
        );
      }
      // 当前回合一致
      expect(restored.currentPlayerId).toBe(state.currentPlayerId);
      expect(restored.turnNumber).toBe(state.turnNumber);
      expect(restored.noCaptureCount).toBe(state.noCaptureCount);
      // 游戏阶段一致
      expect(restored.status).toEqual(state.status);
      // 阵营绑定一致
      expect(restored.players).toEqual(state.players);
      // 历史记录一致
      expect(restored.actionLog).toEqual(state.actionLog);
      // 整体一致
      expect(restored).toEqual(state);
    });

    it('恢复后的状态与原始状态完全独立（无共享引用）', () => {
      const s0 = mode.createInitialState(1);
      const restored = roundTrip(s0);
      expect(restored).not.toBe(s0);
      expect(restored.board).not.toBe(s0.board);
      expect(restored.board.cells).not.toBe(s0.board.cells);
      expect(restored.players).not.toBe(s0.players);
      expect(restored.actionLog).not.toBe(s0.actionLog);
    });

    it('恢复后继续对局，结果与不序列化完全一致', () => {
      const rng = mulberry32(77);
      let branchA = play(mode.createInitialState(5), 6);
      let branchB = roundTrip(branchA);
      let guard = 0;
      while (branchA.status.kind === 'inProgress' && guard < 300) {
        const actions = engine.getLegalActions(branchA);
        const pick = actions[rng.nextInt(actions.length)]!;
        branchA = engine.apply(branchA, pick);
        branchB = engine.apply(branchB, pick);
        guard += 1;
      }
      expect(branchB).toEqual(branchA);
    });

    it('终局：胜局往返一致', () => {
      const won = engine.apply(
        buildState(
          [
            { x: 1, y: 1, type: 'ROOK', color: 'BLACK', revealed: true },
            { x: 2, y: 1, type: 'PAWN', color: 'RED', revealed: true },
          ],
          { currentPlayer: 'B' },
        ),
        { kind: 'move', from: { x: 1, y: 1 }, to: { x: 2, y: 1 } },
      );
      expect(won.status.kind).toBe('won');
      const restored = roundTrip(won);
      expect(restored).toEqual(won);
      expect(restored.status).toEqual({ kind: 'won', winner: 'BLACK' });
    });

    it('终局：未吃子判和往返一致', () => {
      const drawn = engine.apply(
        buildState(
          [
            { x: 1, y: 1, type: 'ROOK', color: 'RED', revealed: true },
            { x: 2, y: 1, type: 'ROOK', color: 'BLACK', revealed: true },
          ],
          { currentPlayer: 'A', noCaptureCount: NO_CAPTURE_DRAW_THRESHOLD - 1 },
        ),
        { kind: 'move', from: { x: 1, y: 1 }, to: { x: 1, y: 2 } },
      );
      expect(drawn.status.kind).toBe('drawn');
      const restored = roundTrip(drawn);
      expect(restored).toEqual(drawn);
      expect(restored.status).toEqual({
        kind: 'drawn',
        reason: { kind: 'noCapture', threshold: NO_CAPTURE_DRAW_THRESHOLD },
      });
    });

    it('引擎产生的任意状态都能通过校验并往返一致', () => {
      const rng = mulberry32(999);
      let state = mode.createInitialState(42);
      for (let i = 0; i < 200 && state.status.kind === 'inProgress'; i++) {
        expect(() => validateGameState(state)).not.toThrow();
        const actions = engine.getLegalActions(state);
        state = engine.apply(state, actions[rng.nextInt(actions.length)]!);
        expect(roundTrip(state)).toEqual(state);
      }
      expect(() => validateGameState(state)).not.toThrow();
    });
  });

  describe('数据校验', () => {
    const s0 = mode.createInitialState(1);

    it('非法 JSON / 非对象输入抛错', () => {
      expect(() => serializer.parse('{oops')).toThrow();
      expect(() => serializer.parse('')).toThrow();
      expect(() => serializer.parse('null')).toThrow();
      expect(() => serializer.parse('42')).toThrow();
      expect(() => serializer.parse('"str"')).toThrow();
    });

    it('顶层字段缺失抛错', () => {
      const keys = [
        'schemaVersion',
        'modeId',
        'board',
        'players',
        'currentPlayerId',
        'turnNumber',
        'noCaptureCount',
        'status',
        'repetitionKey',
        'actionLog',
      ];
      for (const key of keys) {
        const json = tamper(s0, (obj) => {
          delete obj[key];
        });
        expect(() => serializer.parse(json), `缺少 ${key} 应抛错`).toThrow();
      }
    });

    it('schemaVersion 不匹配抛错', () => {
      expect(() => serializer.parse(tamper(s0, (obj) => (obj.schemaVersion = 999)))).toThrow(
        /schemaVersion/,
      );
    });

    it('棋盘：cells 长度/坐标/棋子结构错误抛错', () => {
      // cells 长度与 width*height 不符
      expect(() =>
        serializer.parse(tamper(s0, (obj) => obj.board.cells.pop())),
      ).toThrow(/cells/);

      // 坐标与行优先下标不一致
      expect(() => serializer.parse(tamper(s0, (obj) => (obj.board.cells[0].x = 1)))).toThrow(
        /坐标/,
      );

      // 未知棋子类型
      expect(() =>
        serializer.parse(tamper(s0, (obj) => (obj.board.cells[0].piece.type = 'QUEEN'))),
      ).toThrow(/棋子类型/);

      // 棋子缺 revealed
      expect(() =>
        serializer.parse(tamper(s0, (obj) => delete obj.board.cells[1].piece.revealed)),
      ).toThrow(/revealed/);

      // 棋子 id 重复
      expect(() =>
        serializer.parse(
          tamper(s0, (obj) => (obj.board.cells[1].piece.id = obj.board.cells[0].piece.id)),
        ),
      ).toThrow(/重复/);
    });

    it('玩家：空列表 / id 重复 / currentPlayerId 无效抛错', () => {
      expect(() => serializer.parse(tamper(s0, (obj) => (obj.players = [])))).toThrow(/players/);

      expect(() =>
        serializer.parse(tamper(s0, (obj) => (obj.players[1].id = obj.players[0].id))),
      ).toThrow(/重复/);

      expect(() =>
        serializer.parse(tamper(s0, (obj) => (obj.currentPlayerId = 'X'))),
      ).toThrow(/currentPlayerId/);
    });

    it('计数：turnNumber / noCaptureCount 非法抛错', () => {
      for (const bad of [-1, 1.5, '3']) {
        expect(() =>
          serializer.parse(tamper(s0, (obj) => (obj.turnNumber = bad))),
        ).toThrow();
      }
      expect(() =>
        serializer.parse(tamper(s0, (obj) => (obj.noCaptureCount = -2))),
      ).toThrow(/noCaptureCount/);
    });

    it('status：非法阶段/负载抛错', () => {
      expect(() => serializer.parse(tamper(s0, (obj) => (obj.status = { kind: 'won' })))).toThrow(
        /winner/,
      );

      expect(() =>
        serializer.parse(tamper(s0, (obj) => (obj.status = { kind: 'drawn', reason: { kind: 'unknown' } }))),
      ).toThrow(/和棋原因/);

      expect(() => serializer.parse(tamper(s0, (obj) => (obj.status = { kind: 'paused' })))).toThrow(
        /未知状态/,
      );
    });

    it('历史记录：非法记录抛错', () => {
      const state = play(mode.createInitialState(3), 6);
      expect(state.actionLog.length).toBeGreaterThan(0);

      // 记录引用了不存在的玩家
      expect(() =>
        serializer.parse(tamper(state, (obj) => (obj.actionLog[0].playerId = 'X'))),
      ).toThrow(/playerId/);

      // 动作位置越界
      expect(() =>
        serializer.parse(
          tamper(state, (obj) => {
            const rec = obj.actionLog[0].action;
            if (rec.kind === 'move') rec.to = { x: 99, y: 99 };
            else rec.position = { x: -1, y: 0 };
          }),
        ),
      ).toThrow(/边界|坐标/);

      // actionLog 长度与 turnNumber 不一致
      expect(() =>
        serializer.parse(tamper(state, (obj) => obj.actionLog.pop())),
      ).toThrow(/actionLog/);
    });

    it('repetitionKey 与当前局面不一致抛错', () => {
      const state = play(mode.createInitialState(3), 6);
      expect(() =>
        serializer.parse(tamper(state, (obj) => (obj.repetitionKey = 'tampered'))),
      ).toThrow(/repetitionKey/);
    });

    it('独立函数 serializeGameState / deserializeGameState 行为一致', () => {
      const json = serializeGameState(s0);
      expect(deserializeGameState(json)).toEqual(s0);
      expect(() => deserializeGameState('{bad')).toThrow();
    });

    it('serialize 拒绝残缺状态（fail-fast）', () => {
      const obj: any = JSON.parse(serializer.serialize(s0));
      delete obj.board;
      expect(() => serializeGameState(obj as GameState)).toThrow(/board/);
    });
  });
});
