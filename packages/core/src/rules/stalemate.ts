import type { GameStatus, GameState } from '../model/game-state';

/**
 * 僵局处置结果：
 * - `ended`：就此终局（两人玩法的“对手获胜”）；
 * - `continue`：处置后继续对局（三人玩法的“当前玩家判负退出，剩余玩家继续”），
 *   返回的 state 由规则负责保持内部一致（如重算 repetitionKey）。
 */
export type StalemateResolution =
  | { readonly kind: 'ended'; readonly status: GameStatus }
  | { readonly kind: 'continue'; readonly state: GameState };

/**
 * 僵局结算规则：当胜负条件与和棋条件都未命中、且当前玩家没有任何合法动作
 * （无移动/吃子，也没有可翻的棋子）时，引擎调用它做处置。
 *
 * “无动作如何处置”属于玩法规则：二人玩法是对手获胜；三人玩法是当前玩家
 * 判负退出、剩余玩家继续。引擎不做任何假设，只按固定顺序（胜负 -> 和棋 -> 僵局）
 * 询问本规则；处置若返回 continue，引擎会重新结算（胜负/和棋/僵局）。
 *
 * 返回 null 表示不在此处置，状态将保持进行中（注意：此时当前玩家无动作可执行）。
 */
export interface StalemateRule {
  resolve(state: GameState): StalemateResolution | null;
}
