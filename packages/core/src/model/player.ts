import type { FactionId, PlayerId } from './ids';

/**
 * 玩家（座位/参与者）。
 * 开局时不能提前决定谁红谁黑，故 `factionId` 初始为 null；
 * 第一枚翻出的棋子颜色决定 Player A 阵营后固定。
 */
export interface Player {
  readonly id: PlayerId;
  readonly name: string | null;
  readonly factionId: FactionId | null;
}
