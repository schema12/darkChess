import type { Faction } from '../../model/faction';
import type { BoardConfig, PieceSpec } from '../game-mode';
import type { PieceType } from '../../model/piece';

/**
 * 玩法一：4×8 暗棋/翻棋（需求二/三/四）。
 * 本文件只放“完全确定”的静态配置：棋盘尺寸、棋子池、阵营、玩家、颜色。
 * 移动/吃子/胜负/和棋规则见 rules.ts（Phase 2 实现）。
 */

export const MODE_ID = 'dark-chess-4x8';
export const MODE_NAME = '暗棋 4×8（玩法一）';

export const boardConfig: BoardConfig = { width: 4, height: 8 };

export const COLOR_RED = 'RED';
export const COLOR_BLACK = 'BLACK';

export const FACTION_RED = 'RED';
export const FACTION_BLACK = 'BLACK';

export const PLAYER_A = 'A';
export const PLAYER_B = 'B';

/**
 * 和棋阈值（可配置，不写死进引擎）。
 * 未吃子阈值暂取 40；重复局面判和阈值按用户确认为 5。
 */
export const NO_CAPTURE_DRAW_THRESHOLD = 40;
export const REPETITION_DRAW_THRESHOLD = 5;

/** 当前玩法阵营与颜色一一对应（需求二十三：模型允许未来解耦）。 */
export const factions: readonly Faction[] = [
  { id: FACTION_RED, displayName: '红方', colors: [COLOR_RED] },
  { id: FACTION_BLACK, displayName: '黑方', colors: [COLOR_BLACK] },
];

/** 棋子颜色 -> 阵营（当前为恒等映射，属“已确定”规则，可安全实现）。 */
export function factionForColor(color: string): string {
  if (color === COLOR_RED) return FACTION_RED;
  if (color === COLOR_BLACK) return FACTION_BLACK;
  throw new Error(`未知棋子颜色: ${color}`);
}

function specs(type: PieceType, color: string, count: number): PieceSpec[] {
  return Array.from({ length: count }, () => ({ type, color }));
}

/**
 * 32 枚固定初始棋子（需求三）。
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
