import type { ColorId, PieceType } from '@darkchess/core';

/**
 * 棋子正面文字（红/黑，按中国象棋传统字形区分）。
 * 仅影响 UI 显示，core 中仍使用统一的 PieceType + Color/Faction。
 */
const CHAR: Record<PieceType, { red: string; black: string }> = {
  KING: { red: '帅', black: '将' },
  ADVISOR: { red: '仕', black: '士' },
  ELEPHANT: { red: '相', black: '象' },
  ROOK: { red: '车', black: '車' },
  KNIGHT: { red: '马', black: '馬' },
  CANNON: { red: '炮', black: '砲' },
  PAWN: { red: '兵', black: '卒' },
};

/** 颜色 -> 墨色（未来新增颜色在此扩展）。 */
const INK: Record<string, string> = {
  RED: '#c62828',
  BLACK: '#1c1c1c',
};

function inkColor(color: ColorId): string {
  return INK[color] ?? '#333333';
}

function pieceChar(type: PieceType, color: ColorId): string {
  return color === 'RED' ? CHAR[type].red : CHAR[type].black;
}

/** 把 SVG 字符串编码为可内嵌的 data URI。 */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** 棋子正面（程序生成占位素材）。 */
export function pieceFrontSvg(type: PieceType, color: ColorId): string {
  const ch = pieceChar(type, color);
  const ink = inkColor(color);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="28" fill="#f7ecd6" stroke="${ink}" stroke-width="3"/>
  <circle cx="32" cy="32" r="22" fill="none" stroke="${ink}" stroke-width="1"/>
  <text x="32" y="43" text-anchor="middle" font-size="30" font-family="serif" fill="${ink}">${ch}</text>
</svg>`;
}

/** 棋子背面（程序生成占位素材）。 */
export function pieceBackSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="28" fill="#7a5c3a" stroke="#4c3a24" stroke-width="3"/>
  <circle cx="32" cy="32" r="16" fill="none" stroke="#d8c3a0" stroke-width="2"/>
  <circle cx="32" cy="32" r="4" fill="#d8c3a0"/>
</svg>`;
}

/** 棋盘背景（程序生成占位素材）。 */
export function boardSvg(width: number, height: number): string {
  const w = width * 64;
  const h = height * 64;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect x="0" y="0" width="${w}" height="${h}" fill="#e8d3ab"/>
  <rect x="2" y="2" width="${w - 4}" height="${h - 4}" fill="none" stroke="#8a6d3b" stroke-width="4"/>
</svg>`;
}
