import type { PlayerId } from '../model/ids';
import type { GameState } from '../model/game-state';

/**
 * 回合管理（需求五）：每动作 = 一回合，动作后换手。
 * turnNumber / noCaptureCount 的更新由引擎在 apply 中完成。
 * 多人玩法下已淘汰（eliminated）的玩家不再获得回合。
 */
export interface TurnManager {
  currentPlayer(state: GameState): PlayerId;
  nextPlayer(state: GameState): PlayerId;
}

/**
 * 从 fromId 起寻找下一个未淘汰玩家（不含 fromId 自身；跳过 eliminated）。
 * 不存在未淘汰玩家时返回 null（防御：正常对局中“仅剩一名未淘汰玩家”时
 * 结算规则已先行终局，不会轮转到本函数）。
 */
export function nextActivePlayerId(state: GameState, fromId: PlayerId): PlayerId | null {
  const n = state.players.length;
  const idx = state.players.findIndex((p) => p.id === fromId);
  if (idx === -1) return null;
  for (let step = 1; step <= n; step++) {
    const candidate = state.players[(idx + step) % n];
    if (candidate && candidate.eliminated !== true) return candidate.id;
  }
  return null;
}

/** 按玩家列表顺序轮流换手（跳过已淘汰玩家）。 */
export function createTurnManager(): TurnManager {
  return {
    currentPlayer(state) {
      return state.currentPlayerId;
    },
    nextPlayer(state) {
      const next = nextActivePlayerId(state, state.currentPlayerId);
      if (next === null) {
        throw new Error('回合轮转失败：没有未淘汰的玩家');
      }
      return next;
    },
  };
}
