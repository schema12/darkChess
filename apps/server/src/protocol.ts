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
  | { readonly type: 'resign' }
  | { readonly type: 'drawOffer' }
  | { readonly type: 'drawResponse'; readonly accept: boolean }
  | { readonly type: 'rematchReady' };

/** 服务端 -> 客户端。 */
export type ServerMessage =
  | {
      readonly type: 'welcome';
      readonly roomId: string;
      readonly playerId: PlayerId;
      readonly token: string;
      readonly status: RoomStatus;
      readonly config: RoomConfigInfo;
    }
  | {
      readonly type: 'roomStatus';
      readonly status: RoomStatus;
      readonly players: readonly RoomPlayerInfo[];
      readonly config: RoomConfigInfo;
      /** 已点击“再来一局”的玩家（terminal 后的重新开局准备）。 */
      readonly rematchReady: readonly PlayerId[];
    }
  | {
      readonly type: 'drawOffer';
      readonly fromPlayerId: PlayerId;
      /** 发起者已消耗的求和次数（含本次）。 */
      readonly count: number;
      readonly max: number;
    }
  | {
      readonly type: 'drawResponse';
      readonly fromPlayerId: PlayerId;
      readonly accept: boolean;
      /** true = 本次回应使提议终结（拒绝/作废/全体同意）；false = 多人局仍有待回应者。 */
      readonly resolved: boolean;
    }
  | {
      readonly type: 'state';
      readonly state: GameState;
      /** 当前回合剩余秒数（广播时间点取样；null/缺省 = 不限时）。权威判定仍在服务端。 */
      readonly turnRemainingSec?: number | null;
    }
  | { readonly type: 'eliminated'; readonly playerId: PlayerId; readonly reason: EliminationReason }
  | { readonly type: 'rejected'; readonly code: string; readonly reason: string };

/** 房间配置（由房主创建时决定，服务器权威；加入者只读）。 */
export interface RoomConfigInfo {
  readonly modeId: string;
  /** 回合计时秒数；null = 不限时。 */
  readonly timerSec: number | null;
}

/** 房间内单个座位的公开信息（不含任何隐藏棋子信息）。 */
export interface RoomPlayerInfo {
  readonly playerId: PlayerId;
  readonly connected: boolean;
  readonly factionId: string | null;
  readonly eliminated: boolean;
  /** 房主 = 创建房间（首个入座）的玩家；模式/计时等配置由其决定。 */
  readonly isHost: boolean;
}
