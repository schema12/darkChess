import type { Position } from '../model/board';
import type { GameState } from '../model/game-state';

/**
 * 翻棋规则（需求五/六）。
 * 一般返回所有未翻开格；当“无任何合法移动/吃子且仍有未翻开棋子”时，
 * 由引擎据此兜底强制翻棋，而不是写死在 UI。
 */
export interface RevealRule {
  legalReveals(state: GameState): readonly Position[];
}

/** 当前玩法：所有未翻开格都可被翻。 */
export function createRevealAllRule(): RevealRule {
  return {
    legalReveals(state) {
      const result: Position[] = [];
      for (const cell of state.board.cells) {
        if (cell.piece && !cell.piece.revealed) {
          result.push({ x: cell.x, y: cell.y });
        }
      }
      return result;
    },
  };
}
