import type { Faction } from '../../model/faction';
import type { FactionPieceRef, PieceType } from '../../model/piece';
import type { BoardConfig, PieceSpec } from '../game-mode';

/**
 * 玩法二：三人 4×8 暗棋。
 * 本文件只放“完全确定”的静态配置：棋盘尺寸、棋子池、阵营、玩家、阈值。
 * 阵营分配、僵局处置等行为规则见 rules.ts。
 *
 * 三个阵营（按 (type, color) 共同判定，颜色不能单独决定阵营）：
 * - 将帅兵卒阵营（红黑将/帅、红黑兵/卒，共 12 枚）
 * - 红色普通棋子阵营（红士/象/车/马/炮，共 10 枚）
 * - 黑色普通棋子阵营（黑士/象/车/马/炮，共 10 枚）
 */

export const MODE_ID = 'dark-chess-3p-4x8';
export const MODE_NAME = '三人暗棋 4×8（玩法二）';

export const boardConfig: BoardConfig = { width: 4, height: 8 };

export const COLOR_RED = 'RED';
export const COLOR_BLACK = 'BLACK';

export const FACTION_ROYALS = 'KINGS_PAWNS'; // 阵营 1：将帅兵卒（红黑同阵营）
export const FACTION_RED_NORMAL = 'RED_NORMAL'; // 阵营 2：红色普通棋子
export const FACTION_BLACK_NORMAL = 'BLACK_NORMAL'; // 阵营 3：黑色普通棋子

export const PLAYER_A = 'A';
export const PLAYER_B = 'B';
export const PLAYER_C = 'C';

/**
 * 和棋阈值（可配置，不写死进引擎）：
 * 未吃子阈值默认 40；重复局面判和阈值默认 5。与两人玩法保持一致。
 */
export const NO_CAPTURE_DRAW_THRESHOLD = 40;
export const REPETITION_DRAW_THRESHOLD = 5;

/**
 * 阵营定义。注意 Faction.colors 仅为展示性元数据：本玩法中阵营并非
 * 只由颜色决定（将/帅/兵/卒不论颜色同属将帅兵卒阵营），权威判定见 factionOfPiece。
 */
export const factions: readonly Faction[] = [
  { id: FACTION_ROYALS, displayName: '将帅兵卒阵营', colors: [COLOR_RED, COLOR_BLACK] },
  { id: FACTION_RED_NORMAL, displayName: '红色棋子阵营', colors: [COLOR_RED] },
  { id: FACTION_BLACK_NORMAL, displayName: '黑色棋子阵营', colors: [COLOR_BLACK] },
];

/**
 * 棋子（类型+颜色）-> 阵营：
 * - KING / PAWN（不论红黑）-> 将帅兵卒阵营；
 * - 其余类型按颜色归入红/黑普通棋子阵营。
 */
export function factionOfPiece(piece: FactionPieceRef): string {
  if (piece.type === 'KING' || piece.type === 'PAWN') return FACTION_ROYALS;
  if (piece.color === COLOR_RED) return FACTION_RED_NORMAL;
  if (piece.color === COLOR_BLACK) return FACTION_BLACK_NORMAL;
  throw new Error(`无法确定阵营的棋子: ${piece.color} ${piece.type}`);
}

function specs(type: PieceType, color: string, count: number): PieceSpec[] {
  return Array.from({ length: count }, () => ({ type, color }));
}

/**
 * 32 枚固定初始棋子（与标准 4×8 暗棋一致；按三人阵营划分后 12 + 10 + 10）。
 * 红：帅1 仕2 相2 车2 马2 炮2 兵5；黑：将1 士2 象2 车2 马2 炮2 卒5。
 */
export const piecePool: readonly PieceSpec[] = [
  ...specs('KING', COLOR_RED, 1),
  ...specs('ADVISOR', COLOR_RED, 2),
  ...specs('ELEPHANT', COLOR_RED, 2),
  ...specs('ROOK', COLOR_RED, 2),
  ...specs('KNIGHT', COLOR_RED, 2),
  ...specs('CANNON', COLOR_RED, 2),
  ...specs('PAWN', COLOR_RED, 5),
  ...specs('KING', COLOR_BLACK, 1),
  ...specs('ADVISOR', COLOR_BLACK, 2),
  ...specs('ELEPHANT', COLOR_BLACK, 2),
  ...specs('ROOK', COLOR_BLACK, 2),
  ...specs('KNIGHT', COLOR_BLACK, 2),
  ...specs('CANNON', COLOR_BLACK, 2),
  ...specs('PAWN', COLOR_BLACK, 5),
];
