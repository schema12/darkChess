import type { Position } from './board';

/**
 * 玩家动作（需求五）：
 * - `reveal`：翻棋（翻棋本身就是一步）
 * - `move`：移动/吃子（移动到敌方棋子格即吃子，由引擎按目标格推导）
 *
 * 每个玩家回合只执行一个动作。
 */
export type GameAction =
  | { readonly kind: 'reveal'; readonly position: Position }
  | { readonly kind: 'move'; readonly from: Position; readonly to: Position };
