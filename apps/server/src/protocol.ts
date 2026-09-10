import type { GameAction, GameState, PlayerId } from '@darkchess/core';

/** 房间状态：等待入座 / 对局中 / 已结束。 */
export type RoomStatus = 'waiting' | 'playing' | 'finished';

/** 淘汰原因（服务端权威声明；客户端不得自行推断超时等原因）。 */
export type EliminationReason = 'timeout' | 'noLegalAction' | 'resign';

/**
 * 客户端 -> 服务端。
 * 安全边界：客户端声明的任何 playerId/faction/eliminated/winner 一律无效——
 * 服务端以连接建立时绑定的座位身份处理消息。
 */
export type ClientMessage =
  | { readonly type: 'command'; readonly action: GameAction }
  | { readonly type: 'resign' };

/** 服务端 -> 客户端。 */
export type ServerMessage =
  | {
      readonly type: 'welcome';
      readonly roomId: string;
      readonly playerId: PlayerId;
      readonly token: string;
      readonly status: RoomStatus;
    }
  | {
      readonly type: 'roomStatus';
      readonly status: RoomStatus;
      readonly players: readonly RoomPlayerInfo[];
    }
  | { readonly type: 'state'; readonly state: GameState }
  | { readonly type: 'eliminated'; readonly playerId: PlayerId; readonly reason: EliminationReason }
  | { readonly type: 'rejected'; readonly code: string; readonly reason: string };

/** 房间内单个座位的公开信息（不含任何隐藏棋子信息）。 */
export interface RoomPlayerInfo {
  readonly playerId: PlayerId;
  readonly connected: boolean;
  readonly factionId: string | null;
  readonly eliminated: boolean;
}
