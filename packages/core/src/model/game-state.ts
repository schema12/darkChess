import type { GameAction } from './action';
import type { Board } from './board';
import type { FactionId, PlayerId } from './ids';
import type { Player } from './player';

/** 序列化 schema 版本，用于未来加载旧存档时做迁移。 */
export const SCHEMA_VERSION = 1;

/** 和棋原因（需求十五），由 DrawCondition 产生。 */
export type DrawReason =
  | { readonly kind: 'noCapture'; readonly threshold: number } // 连续未吃子达阈值
  | { readonly kind: 'repetition'; readonly count: number }; // 重复局面达次数

/** 对局状态：进行中 / 某方胜 / 和棋。 */
export type GameStatus =
  | { readonly kind: 'inProgress' }
  | { readonly kind: 'won'; readonly winner: FactionId }
  | { readonly kind: 'drawn'; readonly reason: DrawReason };

/** 回放动作记录：动作 + 执行后局面指纹。 */
export interface MoveRecord {
  readonly playerId: PlayerId;
  readonly turnNumber: number;
  readonly action: GameAction;
  readonly repetitionKey: string;
}

/**
 * 完整的、可序列化的游戏状态（需求十六）。
 * 不可变：每次动作生成新的 GameState，便于 AI / 存档 / 回放 / 联网同步 / 调试。
 */
export interface GameState {
  readonly schemaVersion: number;
  readonly modeId: string;
  readonly board: Board;
  readonly players: readonly Player[];
  readonly currentPlayerId: PlayerId;
  /** 已进行的动作数（1 起）。 */
  readonly turnNumber: number;
  /** 连续未吃子动作数，仅吃子时归零。 */
  readonly noCaptureCount: number;
  readonly status: GameStatus;
  /**
   * 重复局面指纹：只含（所有格子的 type/color/revealed、当前玩家、阵营绑定），
   * 不含 turnNumber / noCaptureCount 等计数类字段，否则“完全相同局面”永远不相等。
   */
  readonly repetitionKey: string;
  readonly actionLog: readonly MoveRecord[];
}
