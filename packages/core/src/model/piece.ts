import type { ColorId, PieceId } from './ids';

/**
 * 抽象棋子类型（需求三）：
 * “将/帅”“士/仕”“象/相”“兵/卒”是同一种类型，只是颜色不同。
 * 该类型跨玩法稳定，具体玩法只引用这些抽象类型。
 */
export const PIECE_TYPES = [
  'KING',
  'ADVISOR',
  'ELEPHANT',
  'ROOK',
  'KNIGHT',
  'CANNON',
  'PAWN',
] as const;

export type PieceType = (typeof PIECE_TYPES)[number];

/**
 * 棋子实例。
 * 归属永远由 `color` 决定（需求四/五），与谁执行翻棋无关。
 */
export interface Piece {
  readonly id: PieceId;
  readonly type: PieceType;
  readonly color: ColorId;
  readonly revealed: boolean; // 翻开后永久公开
}

/**
 * 阵营判定所需的最小棋子引用。
 * 两人玩法的阵营只由颜色决定；三人玩法的阵营由 (type, color) 共同决定
 * （将/帅/兵/卒不论颜色同属一阵营），因此阵营函数以此为入参。
 */
export type FactionPieceRef = Pick<Piece, 'type' | 'color'>;
