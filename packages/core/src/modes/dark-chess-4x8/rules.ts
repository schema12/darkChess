import type { PieceType } from '../../model/piece';
import { buildCaptureMatrix, createMatrixCaptureRule } from '../../rules/capture';
import {
  cannonSlide,
  diagonalStep,
  orthogonalStep,
  slide,
} from '../../rules/movement';
import type { MovementContext } from '../../rules/movement';
import type { MovementRule } from '../../rules/movement';
import { createRevealAllRule } from '../../rules/reveal';
import { createEliminationWinCondition } from '../../rules/win-condition';
import {
  createNoCaptureDrawCondition,
  createRepetitionDrawCondition,
} from '../../rules/draw-condition';
import type { RuleSet } from '../../rules/rule-set';
import {
  factions,
  factionForColor,
  NO_CAPTURE_DRAW_THRESHOLD,
  REPETITION_DRAW_THRESHOLD,
} from './config';

const ALL_TYPES: readonly PieceType[] = [
  'KING',
  'ADVISOR',
  'ELEPHANT',
  'ROOK',
  'KNIGHT',
  'CANNON',
  'PAWN',
];

/**
 * 玩法一规则集。
 *
 * 吃子表（需求七 + 用户确认“同类异色可互吃”）：
 * - KING    吃：ADVISOR/ELEPHANT/ROOK/KNIGHT/CANNON/KING；不吃 PAWN
 * - ADVISOR 吃：ELEPHANT/ROOK/KNIGHT/CANNON/PAWN/ADVISOR；不吃 KING
 * - ELEPHANT 吃：ROOK/KNIGHT/CANNON/PAWN/ELEPHANT；不吃 KING/ADVISOR
 * - ROOK/KNIGHT/CANNON 吃全部
 * - PAWN    吃：PAWN/KING；不吃其余
 *
 * 移动形态：
 * - orthogonalStep：KING/ADVISOR/ELEPHANT/PAWN
 * - diagonalStep：KNIGHT（对角 1 格，无蹩马腿）
 * - slide：ROOK（直线任意格、不可越子）
 * - cannonSlide：CANNON（移动同车；吃子须与目标恰好隔 1 子，不可打空炮）
 */
export function createRuleSet(): RuleSet {
  const capture = createMatrixCaptureRule(
    buildCaptureMatrix({
      KING: ['ADVISOR', 'ELEPHANT', 'ROOK', 'KNIGHT', 'CANNON', 'KING'],
      ADVISOR: ['ELEPHANT', 'ROOK', 'KNIGHT', 'CANNON', 'PAWN', 'ADVISOR'],
      ELEPHANT: ['ROOK', 'KNIGHT', 'CANNON', 'PAWN', 'ELEPHANT'],
      ROOK: ALL_TYPES,
      KNIGHT: ALL_TYPES,
      CANNON: ALL_TYPES,
      PAWN: ['PAWN', 'KING'],
    }),
  );

  const ctx: MovementContext = { factionForColor, capture };

  const movement = new Map<PieceType, MovementRule>([
    ['KING', orthogonalStep(ctx)],
    ['ADVISOR', orthogonalStep(ctx)],
    ['ELEPHANT', orthogonalStep(ctx)],
    ['PAWN', orthogonalStep(ctx)],
    ['KNIGHT', diagonalStep(ctx)],
    ['ROOK', slide(ctx)],
    ['CANNON', cannonSlide(ctx)],
  ]);

  return {
    capture,
    movement,
    reveal: createRevealAllRule(),
    winConditions: [createEliminationWinCondition(factions, factionForColor)],
    drawConditions: [
      createNoCaptureDrawCondition(NO_CAPTURE_DRAW_THRESHOLD),
      createRepetitionDrawCondition(REPETITION_DRAW_THRESHOLD),
    ],
  };
}
