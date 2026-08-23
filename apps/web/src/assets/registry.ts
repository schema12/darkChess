import type { ColorId, PieceType } from '@darkchess/core';
import { boardSvg, pieceBackSvg, pieceFrontSvg, svgDataUri } from './svg';

export type AssetKey = string;

/**
 * 资源层：所有棋盘/棋子素材都经由此层获取。
 * 当前用程序生成的 SVG 占位素材；后续替换真实素材只需改这里，UI 与核心逻辑无需改动。
 */
export const assetRegistry = {
  piece(type: PieceType, color: ColorId, revealed: boolean): string {
    return svgDataUri(revealed ? pieceFrontSvg(type, color) : pieceBackSvg());
  },
  board(width: number, height: number): string {
    return svgDataUri(boardSvg(width, height));
  },
};
