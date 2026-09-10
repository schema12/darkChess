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
import {
  createEliminationWinCondition,
  createLastActivePlayerWinCondition,
} from '../../rules/win-condition';
import {
  createNoCaptureDrawCondition,
  createRepetitionDrawCondition,
} from '../../rules/draw-condition';
import type { RuleSet } from '../../rules/rule-set';
import type { FactionBindingRule } from '../../rules/faction-binding';
import type { StalemateRule } from '../../rules/stalemate';
import {
  factions,
  factionForColor,
  factionOfPiece,
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
 *
 * 阵营绑定（二人玩法）：所有玩家阵营未定时的首次翻棋 →
 * 翻棋者获得翻出颜色对应的阵营，其余玩家获得另一阵营，之后整局不变。
 * 僵局结算（二人玩法）：当前玩家无任何合法动作 → 对手（另一阵营）获胜。
 * （以上两条原先硬编码在通用引擎中，现归属本玩法的 RuleSet。）
 */
function createFirstRevealFactionBinding(): FactionBindingRule {
  return {
    apply(state, event) {
      if (!event) return state.players;
      // 绑定时机：所有玩家阵营未定时发生翻棋（已绑定则不再变更）。
      if (state.players.some((pl) => pl.factionId !== null)) return state.players;
      const revealedFaction = factionForColor(event.revealedColor);
      const otherFaction = factions.find((f) => f.id !== revealedFaction);
      return state.players.map((pl) =>
        pl.id === event.revealerId
          ? { ...pl, factionId: revealedFaction }
          : { ...pl, factionId: otherFaction ? otherFaction.id : pl.factionId },
      );
    },
  };
}

function createOpponentWinsOnStalemate(): StalemateRule {
  return {
    resolve(state) {
      const loser = state.players.find((p) => p.id === state.currentPlayerId);
      const winner = factions.find((f) => f.id !== (loser ? loser.factionId : undefined));
      return winner ? { kind: 'ended', status: { kind: 'won', winner: winner.id } } : null;
    },
  };
}

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

  const ctx: MovementContext = { factionOf: factionOfPiece, capture };

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
    factionBinding: createFirstRevealFactionBinding(),
    winConditions: [
      createEliminationWinCondition(factions, factionOfPiece),
      // 防御性兜底：二人玩法自身规则不会产生淘汰，但权威判负（forfeit）是
      // 通用引擎能力——一方被判负时另一方应立即获胜，而不是留下无人对局的状态。
      createLastActivePlayerWinCondition(),
    ],
    drawConditions: [
      createNoCaptureDrawCondition(NO_CAPTURE_DRAW_THRESHOLD),
      createRepetitionDrawCondition(REPETITION_DRAW_THRESHOLD),
    ],
    stalemate: createOpponentWinsOnStalemate(),
  };
}
