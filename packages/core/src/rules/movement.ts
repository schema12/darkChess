import { isInBounds, pieceAt } from '../model/board';
import type { Position } from '../model/board';
import type { GameState } from '../model/game-state';
import type { ColorId, FactionId } from '../model/ids';
import type { CaptureRule } from './capture';

/**
 * 移动规则：给定状态与起点，返回所有合法目标格。
 * 共同限制（越界/己方格/未翻开格/吃子能力）在具体实现里统一处理，
 * 具体玩法按“形态”复用这些工厂，而不写 `if 车 / if 炮`。
 */
export interface MovementRule {
  legalDestinations(state: GameState, from: Position): readonly Position[];
}

/** 抽象移动形态（需求八~十一）。 */
export type MovementRuleKind =
  | 'orthogonalStep'
  | 'diagonalStep'
  | 'slide'
  | 'cannonSlide';

/** 移动规则需要的上下文：颜色->阵营映射 与 吃子规则。 */
export interface MovementContext {
  factionForColor(color: ColorId): FactionId;
  capture: CaptureRule;
}

const ORTHOGONAL_DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, -1], // 上
  [0, 1], // 下
  [-1, 0], // 左
  [1, 0], // 右
];

const DIAGONAL_DIRS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], // 左上
  [1, -1], // 右上
  [-1, 1], // 左下
  [1, 1], // 右下
];

/** 上下左右 1 格（将/帅、士/仕、象/相、兵/卒）。 */
export function orthogonalStep(ctx: MovementContext): MovementRule {
  return stepRule(ctx, ORTHOGONAL_DIRS);
}

/** 对角 1 格，无蹩马腿（马）。 */
export function diagonalStep(ctx: MovementContext): MovementRule {
  return stepRule(ctx, DIAGONAL_DIRS);
}

function stepRule(ctx: MovementContext, dirs: ReadonlyArray<readonly [number, number]>): MovementRule {
  return {
    legalDestinations(state, from) {
      const piece = pieceAt(state.board, from);
      if (!piece) return [];
      const own = ctx.factionForColor(piece.color);
      const result: Position[] = [];
      for (const [dx, dy] of dirs) {
        const to = { x: from.x + dx, y: from.y + dy };
        if (!isInBounds(state.board, to)) continue;
        const target = pieceAt(state.board, to);
        if (target === null) {
          result.push(to);
          continue;
        }
        if (!target.revealed) continue;
        if (ctx.factionForColor(target.color) === own) continue;
        if (ctx.capture.canCapture(piece.type, target.type)) result.push(to);
      }
      return result;
    },
  };
}

/** 直线任意格、不可越任何棋子（车）。 */
export function slide(ctx: MovementContext): MovementRule {
  return {
    legalDestinations(state, from) {
      const piece = pieceAt(state.board, from);
      if (!piece) return [];
      const own = ctx.factionForColor(piece.color);
      const result: Position[] = [];
      for (const [dx, dy] of ORTHOGONAL_DIRS) {
        let x = from.x + dx;
        let y = from.y + dy;
        while (isInBounds(state.board, { x, y })) {
          const target = pieceAt(state.board, { x, y });
          if (target === null) {
            result.push({ x, y });
            x += dx;
            y += dy;
            continue;
          }
          // 遇到第一个棋子：若为可吃的敌方则作为吃子目标，随后停止（不可越子）。
          if (
            target.revealed &&
            ctx.factionForColor(target.color) !== own &&
            ctx.capture.canCapture(piece.type, target.type)
          ) {
            result.push({ x, y });
          }
          break;
        }
      }
      return result;
    },
  };
}

/** 移动同车、吃子须与目标恰好隔 1 子（炮）。 */
export function cannonSlide(ctx: MovementContext): MovementRule {
  return {
    legalDestinations(state, from) {
      const piece = pieceAt(state.board, from);
      if (!piece) return [];
      const own = ctx.factionForColor(piece.color);
      const result: Position[] = [];
      for (const [dx, dy] of ORTHOGONAL_DIRS) {
        let x = from.x + dx;
        let y = from.y + dy;
        // 普通移动：连续空格，遇到任何棋子停（不可越子）。
        while (isInBounds(state.board, { x, y }) && pieceAt(state.board, { x, y }) === null) {
          result.push({ x, y });
          x += dx;
          y += dy;
        }
        if (!isInBounds(state.board, { x, y })) continue;
        // (x,y) 是炮架；越过空格找到炮架后的第一个棋子作为候选目标。
        let tx = x + dx;
        let ty = y + dy;
        while (isInBounds(state.board, { x: tx, y: ty }) && pieceAt(state.board, { x: tx, y: ty }) === null) {
          tx += dx;
          ty += dy;
        }
        if (!isInBounds(state.board, { x: tx, y: ty })) continue;
        const target = pieceAt(state.board, { x: tx, y: ty });
        if (
          target !== null &&
          target.revealed &&
          ctx.factionForColor(target.color) !== own &&
          ctx.capture.canCapture(piece.type, target.type)
        ) {
          result.push({ x: tx, y: ty });
        }
      }
      return result;
    },
  };
}
