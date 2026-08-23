import { PIECE_TYPES } from '../model/piece';
import type { PieceType } from '../model/piece';

/**
 * 吃子规则（需求七）：只与 (攻击方类型, 被攻击方类型) 有关，与颜色无关。
 * 是否能吃己方由上层统一禁止，这里只回答“类型 A 能否吃掉类型 B”。
 */
export interface CaptureRule {
  canCapture(attacker: PieceType, defender: PieceType): boolean;
}

/** 吃子表：attacker 类型 -> 可吃掉的 defender 类型集合。 */
export type CaptureMatrix = ReadonlyMap<PieceType, ReadonlySet<PieceType>>;

/**
 * 由纯数据构建吃子表；未列出的类型会被补成空集。
 * 用法：buildCaptureMatrix({ KING: ['ADVISOR','ELEPHANT',...], ... })
 */
export function buildCaptureMatrix(
  table: Record<PieceType, readonly PieceType[]>,
): CaptureMatrix {
  const m = new Map<PieceType, ReadonlySet<PieceType>>();
  for (const t of PIECE_TYPES) {
    m.set(t, new Set<PieceType>(table[t] ?? []));
  }
  return m;
}

/** 基于吃子表实现 CaptureRule。 */
export function createMatrixCaptureRule(matrix: CaptureMatrix): CaptureRule {
  return {
    canCapture(attacker, defender) {
      return matrix.get(attacker)?.has(defender) ?? false;
    },
  };
}
