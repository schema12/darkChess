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
  /**
   * 已被淘汰（多人玩法：无合法行动且无未翻棋子时判负退出，不再参与回合轮转）。
   * 可选字段：两人玩法永不淘汰，旧状态缺省等同 false。
   */
  readonly eliminated?: boolean;
}
