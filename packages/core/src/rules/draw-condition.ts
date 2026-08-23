import type { DrawReason } from '../model/game-state';
import type { GameState } from '../model/game-state';

/**
 * 和棋条件（需求十五）。
 * 以独立条件对象实现，不散落 if/else。
 */
export interface DrawCondition {
  evaluate(state: GameState): DrawReason | null;
}

/** 连续未吃子达阈值判和。 */
export function createNoCaptureDrawCondition(threshold: number): DrawCondition {
  return {
    evaluate(state) {
      if (state.noCaptureCount >= threshold) {
        return { kind: 'noCapture', threshold };
      }
      return null;
    },
  };
}

/** 重复局面达阈值判和（基于 repetitionKey 计数）。 */
export function createRepetitionDrawCondition(threshold: number): DrawCondition {
  return {
    evaluate(state) {
      const key = state.repetitionKey;
      let count = 0;
      for (const r of state.actionLog) {
        if (r.repetitionKey === key) count += 1;
      }
      if (count >= threshold) return { kind: 'repetition', count };
      return null;
    },
  };
}
