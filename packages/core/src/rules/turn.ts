import type { PlayerId } from '../model/ids';
import type { GameState } from '../model/game-state';

/**
 * 回合管理（需求五）：每动作 = 一回合，动作后换手。
 * turnNumber / noCaptureCount 的更新由引擎在 apply 中完成。
 */
export interface TurnManager {
  currentPlayer(state: GameState): PlayerId;
  nextPlayer(state: GameState): PlayerId;
}

/** 按玩家列表顺序轮流换手。 */
export function createTurnManager(): TurnManager {
  return {
    currentPlayer(state) {
      return state.currentPlayerId;
    },
    nextPlayer(state) {
      const idx = state.players.findIndex((p) => p.id === state.currentPlayerId);
      const next = state.players[(idx + 1) % state.players.length];
      return next ? next.id : state.currentPlayerId;
    },
  };
}
