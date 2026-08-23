import type { GameState } from './game-state';

/**
 * 状态序列化契约（需求十六）。
 */
export interface GameStateSerializer {
  serialize(state: GameState): string;
  parse(json: string): GameState;
}

/**
 * 重复局面指纹（需求十五.2）：只含（所有格子的 type/color/revealed、当前玩家、阵营绑定），
 * 不含 turnNumber / noCaptureCount 等计数类字段，否则“完全相同局面”永远不相等。
 */
export function computeRepetitionKey(state: GameState): string {
  const cells = state.board.cells
    .map((c) => {
      const p = c.piece;
      return p ? `${p.type}:${p.color}:${p.revealed ? 'R' : 'U'}` : '.';
    })
    .join('|');
  const players = state.players
    .map((p) => `${p.id}=${p.factionId ?? '-'}`)
    .join(',');
  return `${state.modeId}|${cells}|cur=${state.currentPlayerId}|${players}`;
}

/** 基于 JSON 的序列化实现（GameState 全字段均为 JSON 可序列化）。 */
export function createJsonSerializer(): GameStateSerializer {
  return {
    serialize(state) {
      return JSON.stringify(state);
    },
    parse(json) {
      const obj = JSON.parse(json) as GameState;
      if (
        obj === null ||
        typeof obj !== 'object' ||
        typeof obj.schemaVersion !== 'number' ||
        typeof obj.modeId !== 'string'
      ) {
        throw new Error('无效的游戏状态');
      }
      return obj;
    },
  };
}
