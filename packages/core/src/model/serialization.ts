import type { GameAction } from './action';
import { SCHEMA_VERSION } from './game-state';
import type { GameState } from './game-state';
import { PIECE_TYPES } from './piece';
import type { PieceType } from './piece';

/**
 * 状态序列化契约（需求十六）。
 *
 * 约定：
 * - `serialize` 只接受结构合法、内部一致的 GameState，输出 JSON 字符串；
 * - `parse` 对 JSON 做完整结构校验 + 内部一致性校验，任何不合法输入都会抛 Error，
 *   保证“序列化 -> 解析”能够恢复出完全一致的游戏状态。
 */
export interface GameStateSerializer {
  serialize(state: GameState): string;
  parse(json: string): GameState;
}

const ERR_PREFIX = '无效的游戏状态';

function fail(detail: string): never {
  throw new Error(`${ERR_PREFIX}: ${detail}`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

/** 校验动作中的一个坐标字段（整数且在棋盘内）。 */
function checkPosition(p: unknown, path: string, width: number, height: number): void {
  if (!isRecord(p) || !isNonNegativeInt(p.x) || !isNonNegativeInt(p.y)) {
    fail(`${path} 必须是含整数坐标 x/y 的对象`);
  }
  if (p.x >= width || p.y >= height) {
    fail(`${path} (${p.x},${p.y}) 超出棋盘边界 ${width}x${height}`);
  }
}

/** 校验一个动作（kind + 相关位置）。 */
function checkAction(action: unknown, path: string, width: number, height: number): void {
  if (!isRecord(action)) fail(`${path} 必须是对象`);
  if (action.kind === 'reveal') {
    checkPosition(action.position, `${path}.position`, width, height);
    return;
  }
  if (action.kind === 'move') {
    checkPosition(action.from, `${path}.from`, width, height);
    checkPosition(action.to, `${path}.to`, width, height);
    return;
  }
  fail(`${path}.kind 未知: ${String(action.kind)}`);
}

/**
 * 完整校验一个值是否为结构合法、内部一致的 GameState。
 * 校验通过（否则抛出带原因的 Error），可作类型断言使用。
 *
 * 覆盖项：
 * - 顶层字段与 schemaVersion（当前仅支持 SCHEMA_VERSION，未来在此做存档迁移）；
 * - 棋盘：尺寸、cells 长度、行优先下标与坐标一致、棋子结构、棋子 id 唯一；
 * - 玩家：非空、id 唯一、currentPlayerId 有效且未指向已淘汰玩家；
 * - 计数：turnNumber / noCaptureCount 为非负整数；
 * - 游戏阶段 status：inProgress / won（winner 或 winnerPlayerId）/ drawn（reason）；
 * - 历史 actionLog：玩家有效、动作合法、位置不越界、长度与 turnNumber 一致；
 * - 内部一致性：repetitionKey 必须与当前局面指纹 computeRepetitionKey 一致。
 */
export function validateGameState(value: unknown): asserts value is GameState {
  if (!isRecord(value)) fail('顶层必须是对象');

  if (value.schemaVersion !== SCHEMA_VERSION) {
    fail(`不支持的 schemaVersion=${String(value.schemaVersion)}（当前=${SCHEMA_VERSION}）`);
  }
  if (!isNonEmptyString(value.modeId)) fail('modeId 必须是非空字符串');
  if (!isNonNegativeInt(value.turnNumber)) fail('turnNumber 必须是非负整数');
  if (!isNonNegativeInt(value.noCaptureCount)) fail('noCaptureCount 必须是非负整数');
  if (typeof value.repetitionKey !== 'string') fail('repetitionKey 必须是字符串');

  // —— 棋盘 ——
  const board = value.board;
  if (!isRecord(board)) fail('board 必须是对象');
  if (!isPositiveInt(board.width) || !isPositiveInt(board.height)) {
    fail('board.width/height 必须是正整数');
  }
  const width = board.width;
  const height = board.height;
  const cells = board.cells;
  if (!Array.isArray(cells)) fail('board.cells 必须是数组');
  if (cells.length !== width * height) {
    fail(`board.cells 长度应为 ${width * height}，实际 ${cells.length}`);
  }
  const pieceIds = new Set<string>();
  cells.forEach((cell, idx) => {
    if (!isRecord(cell)) fail(`board.cells[${idx}] 必须是对象`);
    if (!isNonNegativeInt(cell.x) || !isNonNegativeInt(cell.y)) {
      fail(`board.cells[${idx}] 的坐标必须是整数`);
    }
    if (cell.x !== idx % width || cell.y !== Math.floor(idx / width)) {
      fail(`board.cells[${idx}] 坐标 (${cell.x},${cell.y}) 与行优先下标不一致`);
    }
    const piece = cell.piece;
    if (piece === null) return;
    if (!isRecord(piece)) fail(`board.cells[${idx}].piece 必须是对象或 null`);
    if (!isNonEmptyString(piece.id)) fail(`board.cells[${idx}].piece.id 必须是非空字符串`);
    if (pieceIds.has(piece.id)) fail(`棋子 id 重复: ${piece.id}`);
    pieceIds.add(piece.id);
    if (!PIECE_TYPES.includes(piece.type as PieceType)) {
      fail(`未知棋子类型: ${String(piece.type)}`);
    }
    if (!isNonEmptyString(piece.color)) fail(`board.cells[${idx}].piece.color 必须是非空字符串`);
    if (typeof piece.revealed !== 'boolean') fail(`board.cells[${idx}].piece.revealed 必须是布尔值`);
  });

  // —— 玩家 ——
  const players = value.players;
  if (!Array.isArray(players) || players.length === 0) fail('players 必须是非空数组');
  const playerIds = new Set<string>();
  players.forEach((pl, i) => {
    if (!isRecord(pl)) fail(`players[${i}] 必须是对象`);
    if (!isNonEmptyString(pl.id)) fail(`players[${i}].id 必须是非空字符串`);
    if (playerIds.has(pl.id)) fail(`玩家 id 重复: ${pl.id}`);
    playerIds.add(pl.id);
    if (pl.name !== null && typeof pl.name !== 'string') {
      fail(`players[${i}].name 必须是字符串或 null`);
    }
    if (pl.factionId !== null && !isNonEmptyString(pl.factionId)) {
      fail(`players[${i}].factionId 必须是字符串或 null`);
    }
    if (pl.eliminated !== undefined && typeof pl.eliminated !== 'boolean') {
      fail(`players[${i}].eliminated 必须是布尔值`);
    }
  });
  if (!isNonEmptyString(value.currentPlayerId)) fail('currentPlayerId 必须是非空字符串');
  if (!playerIds.has(value.currentPlayerId)) {
    fail(`currentPlayerId=${value.currentPlayerId} 不在玩家列表中`);
  }
  // 一致性：回合绝不会落在已淘汰玩家身上（淘汰玩家永远不能再次行动）。
  const currentPlayer = players.find((pl) => pl.id === value.currentPlayerId);
  if (currentPlayer && currentPlayer.eliminated === true) {
    fail(`currentPlayerId=${value.currentPlayerId} 指向已淘汰的玩家`);
  }

  // —— 游戏阶段 ——
  const status = value.status;
  if (!isRecord(status)) fail('status 必须是对象');
  if (status.kind === 'won') {
    // 阵营判据胜负：winner 为阵营 id；玩家判据胜负（仅剩一名未淘汰玩家）：
    // 已绑定时 winner 为其阵营并附带 winnerPlayerId，未绑定时 winner 为 null。
    const hasFaction = isNonEmptyString(status.winner);
    const hasPlayer = isNonEmptyString(status.winnerPlayerId);
    if (!hasFaction && !hasPlayer) {
      fail('status.winner 必须是阵营 id，或提供 winnerPlayerId（玩家判据胜负）');
    }
    if (status.winnerPlayerId !== undefined && !hasPlayer) {
      fail('status.winnerPlayerId 必须是非空字符串');
    }
    if (hasPlayer && !playerIds.has(status.winnerPlayerId as string)) {
      fail(`status.winnerPlayerId=${String(status.winnerPlayerId)} 不在玩家列表中`);
    }
  } else if (status.kind === 'drawn') {
    const reason = status.reason;
    if (!isRecord(reason)) fail('status.reason 必须是对象');
    if (reason.kind === 'noCapture') {
      if (!isPositiveInt(reason.threshold)) fail('status.reason.threshold 必须是正整数');
    } else if (reason.kind === 'repetition') {
      if (!isPositiveInt(reason.count)) fail('status.reason.count 必须是正整数');
    } else if (reason.kind === 'agreement') {
      // 全体存活玩家同意和棋：无附加负载
    } else {
      fail(`未知和棋原因: ${String(reason.kind)}`);
    }
  } else if (status.kind !== 'inProgress') {
    fail(`未知状态 kind: ${String(status.kind)}`);
  }

  // —— 历史记录 ——
  const actionLog = value.actionLog;
  if (!Array.isArray(actionLog)) fail('actionLog 必须是数组');
  actionLog.forEach((rec, i) => {
    if (!isRecord(rec)) fail(`actionLog[${i}] 必须是对象`);
    if (!isNonEmptyString(rec.playerId) || !playerIds.has(rec.playerId)) {
      fail(`actionLog[${i}].playerId 必须是已存在的玩家 id`);
    }
    if (!isPositiveInt(rec.turnNumber)) fail(`actionLog[${i}].turnNumber 必须是正整数`);
    if (typeof rec.repetitionKey !== 'string') fail(`actionLog[${i}].repetitionKey 必须是字符串`);
    checkAction(rec.action, `actionLog[${i}].action`, width, height);
  });
  if (actionLog.length !== value.turnNumber) {
    fail(`actionLog 长度 ${actionLog.length} 与 turnNumber=${value.turnNumber} 不一致`);
  }

  // —— 内部一致性：repetitionKey 必须与当前局面指纹一致 ——
  // 上面已逐字段校验通过，此处仅作类型收窄。
  const state = value as unknown as GameState;
  if (computeRepetitionKey(state) !== state.repetitionKey) {
    fail('repetitionKey 与当前局面不一致');
  }
}

/**
 * 重复局面指纹（需求十五.2）：只含（所有格子的 type/color/revealed、当前玩家、阵营绑定），
 * 不含 turnNumber / noCaptureCount 等计数类字段，否则“完全相同局面”永远不相等。
 */
export function computeRepetitionKey(state: GameState): string {
  const cells = state.board.cells
    .map((c) => {
      const p = c.piece;
      return p ? `${p.type}:${p.color}:${p.revealed ? 'R' : 'U'}` : '.';
    })
    .join('|');
  // 玩家的淘汰状态影响后续轮转，纳入指纹；两人玩法无淘汰，键值不变。
  const players = state.players
    .map((p) => `${p.id}=${p.factionId ?? '-'}${p.eliminated ? ':out' : ''}`)
    .join(',');
  return `${state.modeId}|${cells}|cur=${state.currentPlayerId}|${players}`;
}

/** 序列化为 JSON 字符串（先校验，避免把残缺对象静默序列化成损坏数据）。 */
export function serializeGameState(state: GameState): string {
  validateGameState(state);
  return JSON.stringify(state);
}

/** 从 JSON 字符串恢复 GameState（完整校验，失败抛 Error）。 */
export function deserializeGameState(json: string): GameState {
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    fail('JSON 解析失败');
  }
  validateGameState(obj);
  return obj;
}

/** 基于 JSON 的序列化实现（GameState 全字段均为 JSON 可序列化）。 */
export function createJsonSerializer(): GameStateSerializer {
  return {
    serialize: serializeGameState,
    parse: deserializeGameState,
  };
}
