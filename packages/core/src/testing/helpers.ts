import { createBoard, withPiece } from '../model/board';
import { SCHEMA_VERSION } from '../model/game-state';
import type { GameState } from '../model/game-state';
import type { ColorId, FactionId, PlayerId } from '../model/ids';
import type { PieceType } from '../model/piece';
import type { Player } from '../model/player';
import { computeRepetitionKey } from '../model/serialization';
import { createEngine } from '../engine/game-engine';
import { createDarkChess4x8Mode } from '../modes/dark-chess-4x8';

export function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error('断言失败: ' + msg);
}

export interface PlacedPiece {
  x: number;
  y: number;
  type: PieceType;
  color: ColorId;
  revealed: boolean;
}

export interface BuildOptions {
  currentPlayer?: PlayerId;
  width?: number;
  height?: number;
  players?: Player[];
  turnNumber?: number;
  noCaptureCount?: number;
}

/** 由一组棋子规格构造可测试的 GameState（默认 A=RED、B=BLACK、A 先手）。 */
export function buildState(pieces: PlacedPiece[], opts: BuildOptions = {}): GameState {
  const width = opts.width ?? 4;
  const height = opts.height ?? 8;
  let board = createBoard(width, height);
  pieces.forEach((p, i) => {
    board = withPiece(
      board,
      { x: p.x, y: p.y },
      { id: `t${i}`, type: p.type, color: p.color, revealed: p.revealed },
    );
  });
  const players = opts.players ?? [
    { id: 'A', name: null, factionId: 'RED' as FactionId },
    { id: 'B', name: null, factionId: 'BLACK' as FactionId },
  ];
  const state: GameState = {
    schemaVersion: SCHEMA_VERSION,
    modeId: 'dark-chess-4x8',
    board,
    players,
    currentPlayerId: opts.currentPlayer ?? 'A',
    turnNumber: opts.turnNumber ?? 0,
    noCaptureCount: opts.noCaptureCount ?? 0,
    status: { kind: 'inProgress' },
    repetitionKey: '',
    actionLog: [],
  };
  return { ...state, repetitionKey: computeRepetitionKey(state) };
}

export interface Build3pOptions {
  currentPlayer?: PlayerId;
  turnNumber?: number;
  noCaptureCount?: number;
  /** 默认三名玩家 A/B/C 且阵营均未定；需要预绑定阵营时显式传入。 */
  players?: Player[];
}

/** 三人玩法（dark-chess-3p-4x8）的测试状态构造器，用法同 buildState。 */
export function build3pState(pieces: PlacedPiece[], opts: Build3pOptions = {}): GameState {
  let board = createBoard(4, 8);
  pieces.forEach((p, i) => {
    board = withPiece(
      board,
      { x: p.x, y: p.y },
      { id: `t${i}`, type: p.type, color: p.color, revealed: p.revealed },
    );
  });
  const players = opts.players ?? [
    { id: 'A', name: null, factionId: null },
    { id: 'B', name: null, factionId: null },
    { id: 'C', name: null, factionId: null },
  ];
  const state: GameState = {
    schemaVersion: SCHEMA_VERSION,
    modeId: 'dark-chess-3p-4x8',
    board,
    players,
    currentPlayerId: opts.currentPlayer ?? 'A',
    turnNumber: opts.turnNumber ?? 0,
    noCaptureCount: opts.noCaptureCount ?? 0,
    status: { kind: 'inProgress' },
    repetitionKey: '',
    actionLog: [],
  };
  return { ...state, repetitionKey: computeRepetitionKey(state) };
}

export const mode = createDarkChess4x8Mode();
export const engine = createEngine(mode);

/** 从 from 出发的所有合法移动目标（"x,y" 字符串集合）。 */
export function moveTargets(state: GameState, from: { x: number; y: number }): Set<string> {
  const targets = new Set<string>();
  for (const a of engine.getLegalActions(state)) {
    if (a.kind === 'move' && a.from.x === from.x && a.from.y === from.y) {
      targets.add(`${a.to.x},${a.to.y}`);
    }
  }
  return targets;
}

export function canMoveTo(
  state: GameState,
  from: { x: number; y: number },
  to: { x: number; y: number },
): boolean {
  return moveTargets(state, from).has(`${to.x},${to.y}`);
}
