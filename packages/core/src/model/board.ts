import type { Piece } from './piece';

export interface Position {
  readonly x: number;
  readonly y: number;
}

/** 棋盘上的一个格子：放置 0 或 1 个棋子。 */
export interface Cell {
  readonly x: number;
  readonly y: number;
  readonly piece: Piece | null;
}

/**
 * 棋盘抽象（需求十七）。
 * `width`/`height` 属于具体 GameMode 的配置，不写死在通用引擎。
 * 当前玩法 width=4、height=8；未来可能是 8×8 或其它。
 */
export interface Board {
  readonly width: number;
  readonly height: number;
  /** 行优先（row-major），长度 = width * height。 */
  readonly cells: readonly Cell[];
}

/** 位置 -> 稳定字符串 key，用于 Map 键。 */
export function positionKey(position: Position): string {
  return `${position.x},${position.y}`;
}

/** 纯几何判断：位置是否落在棋盘内。 */
export function isInBounds(board: Board, position: Position): boolean {
  return (
    position.x >= 0 &&
    position.x < board.width &&
    position.y >= 0 &&
    position.y < board.height
  );
}

/** 取某位置的格子；越界返回 undefined。 */
export function cellAt(board: Board, position: Position): Cell | undefined {
  if (!isInBounds(board, position)) return undefined;
  return board.cells[position.y * board.width + position.x];
}

/** 取某位置的棋子；越界或空格返回 null。 */
export function pieceAt(board: Board, position: Position): Piece | null {
  return cellAt(board, position)?.piece ?? null;
}

/**
 * 创建棋盘。可传入 row-major 的棋子数组（长度 = width*height，可为 null），
 * 不传则创建全空棋盘。
 */
export function createBoard(
  width: number,
  height: number,
  pieces?: readonly (Piece | null)[],
): Board {
  const cells: Cell[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const piece = pieces ? (pieces[idx] ?? null) : null;
      cells.push({ x, y, piece });
    }
  }
  return { width, height, cells };
}

/** 不可变更新：把某位置设为指定棋子（传 null 表示清空），返回新棋盘。 */
export function withPiece(board: Board, position: Position, piece: Piece | null): Board {
  const cells = board.cells.map((c) =>
    c.x === position.x && c.y === position.y ? { ...c, piece } : c,
  );
  return { ...board, cells };
}

/** 棋盘上全部位置（row-major）。 */
export function allPositions(board: Board): Position[] {
  return board.cells.map((c) => ({ x: c.x, y: c.y }));
}
