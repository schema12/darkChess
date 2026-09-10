import { computeRepetitionKey } from '../../model/serialization';
import type { GameState } from '../../model/game-state';
import type { PieceType } from '../../model/piece';
import { buildCaptureMatrix, createMatrixCaptureRule } from '../../rules/capture';
import {
  cannonSlide,
  diagonalStep,
  orthogonalStep,
  slide,
} from '../../rules/movement';
import type { MovementContext, MovementRule } from '../../rules/movement';
import { createRevealAllRule } from '../../rules/reveal';
import {
  createEliminationWinCondition,
  createLastActivePlayerWinCondition,
} from '../../rules/win-condition';
import {
  createNoCaptureDrawCondition,
  createRepetitionDrawCondition,
} from '../../rules/draw-condition';
import type { FactionBindingRule } from '../../rules/faction-binding';
import type { StalemateRule } from '../../rules/stalemate';
import type { RuleSet } from '../../rules/rule-set';
import { nextActivePlayerId } from '../../rules/turn';
import {
  factionOfPiece,
  factions,
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

/** 和棋阈值可按对局覆盖（测试/变体用），默认取 config 的可配置常量。 */
export interface ThreePlayerRuleOptions {
  readonly noCaptureThreshold?: number;
  readonly repetitionThreshold?: number;
}

/**
 * 阵营分配（三人玩法）：
 * - 未分配玩家翻到“尚未被占据阵营”的棋子 -> 立即获得该阵营；
 * - 翻到已被占据阵营的棋子 -> 不获得阵营，保持未分配（可反复发生）；
 * - 已分配玩家翻到任何棋子 -> 不改变阵营；
 * - 当两个玩家分别获得两个不同阵营时，剩余玩家自动获得第三个阵营（无需再翻棋）；
 * - 全部确定后，后续翻棋不再改变阵营。
 */
function createProgressiveFactionBinding(): FactionBindingRule {
  return {
    apply(state, event) {
      if (!event) return state.players;
      let players = state.players;

      const pieceFaction = factionOfPiece({
        type: event.revealedType,
        color: event.revealedColor,
      });
      const revealer = players.find((p) => p.id === event.revealerId);
      const occupiedBy = (list: typeof players) =>
        new Set(list.filter((p) => p.factionId !== null).map((p) => p.factionId as string));

      // 翻棋者未分配，且该棋子所属阵营尚未被占据 -> 立即获得该阵营。
      if (revealer && revealer.factionId === null && !occupiedBy(players).has(pieceFaction)) {
        players = players.map((p) =>
          p.id === event.revealerId ? { ...p, factionId: pieceFaction } : p,
        );
      }

      // 自动分配：未淘汰玩家里只剩一名未分配、且恰剩一个未占据阵营时，
      // 其获得剩余阵营。已淘汰玩家不参与绑定（淘汰玩家永远不能再次行动，
      // 其未绑定的阵营缺口保持无主——阵营棋子保留在棋盘上可被正常捕获）。
      const occupied = occupiedBy(players);
      const unassigned = players.filter(
        (p) => p.factionId === null && p.eliminated !== true,
      );
      if (unassigned.length === 1 && occupied.size === factions.length - 1) {
        const remaining = factions.find((f) => !occupied.has(f.id));
        const targetId = unassigned[0]?.id;
        if (remaining && targetId !== undefined) {
          players = players.map((p) =>
            p.id === targetId ? { ...p, factionId: remaining.id } : p,
          );
        }
      }
      return players;
    },
  };
}

/**
 * 僵局处置（三人玩法）：当前玩家无任何合法动作且无未翻棋子时，
 * 该玩家判负退出——仅标记 eliminated、轮转到下一位未淘汰玩家，对局继续。
 *
 * 规则要点：玩家淘汰 ≠ 阵营棋子消失。被判负玩家的阵营棋子必须全部保留在
 * 棋盘原位置，其他玩家之后仍可按正常捕获规则吃掉它们；淘汰玩家永远不能再次行动。
 * 剩余活跃玩家仅剩一名时，由“最后活跃玩家获胜”胜负条件立即终局（见 winConditions）。
 */
function createEliminateCurrentPlayerStalemate(): StalemateRule {
  return {
    resolve(state) {
      const loser = state.players.find((p) => p.id === state.currentPlayerId);
      if (!loser || loser.eliminated === true) return null;

      const players = state.players.map((p) =>
        p.id === loser.id ? { ...p, eliminated: true } : p,
      );
      const nextId = nextActivePlayerId({ ...state, players }, state.currentPlayerId);
      if (nextId === null) {
        // 防御分支：活跃玩家仅剩一人时“最后活跃玩家获胜”条件已先行终局，正常对局不可达。
        throw new Error('僵局结算时没有可轮转的未淘汰玩家');
      }
      const next: GameState = { ...state, players, currentPlayerId: nextId };
      return {
        kind: 'continue',
        state: { ...next, repetitionKey: computeRepetitionKey(next) },
      };
    },
  };
}

/**
 * 三人玩法规则集。
 *
 * 吃子表（敌我由阵营判定；同阵营棋子永远不能互吃）：
 * - KING    吃：除 PAWN 外全部（将/帅不吃兵/卒）
 * - ADVISOR 吃：除 KING 外全部（士不吃将/帅）
 * - ELEPHANT 吃：除 KING/ADVISOR 外全部（象不吃将/帅、士）
 * - ROOK/KNIGHT/CANNON 吃全部
 * - PAWN    吃全部（三人特例：兵/卒可吃任意类型的敌方阵营棋子）
 *
 * 移动形态与两人玩法一致（复用同一套工厂）：
 * - orthogonalStep：KING/ADVISOR/ELEPHANT/PAWN
 * - diagonalStep：KNIGHT（对角 1 格，无蹩马腿）
 * - slide：ROOK；cannonSlide：CANNON（吃子恰隔 1 子，炮架可为任意棋子含未翻开）
 */
export function createRuleSet(options: ThreePlayerRuleOptions = {}): RuleSet {
  const capture = createMatrixCaptureRule(
    buildCaptureMatrix({
      KING: ['ADVISOR', 'ELEPHANT', 'ROOK', 'KNIGHT', 'CANNON', 'KING'],
      ADVISOR: ['ELEPHANT', 'ROOK', 'KNIGHT', 'CANNON', 'PAWN', 'ADVISOR'],
      ELEPHANT: ['ROOK', 'KNIGHT', 'CANNON', 'PAWN', 'ELEPHANT'],
      ROOK: ALL_TYPES,
      KNIGHT: ALL_TYPES,
      CANNON: ALL_TYPES,
      PAWN: ALL_TYPES,
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
    factionBinding: createProgressiveFactionBinding(),
    winConditions: [
      createEliminationWinCondition(factions, factionOfPiece),
      createLastActivePlayerWinCondition(),
    ],
    drawConditions: [
      createNoCaptureDrawCondition(options.noCaptureThreshold ?? NO_CAPTURE_DRAW_THRESHOLD),
      createRepetitionDrawCondition(options.repetitionThreshold ?? REPETITION_DRAW_THRESHOLD),
    ],
    stalemate: createEliminateCurrentPlayerStalemate(),
  };
}
