import type { GameState } from '../model/game-state';
import type { ColorId, PlayerId } from '../model/ids';
import type { Player } from '../model/player';
import type { PieceType } from '../model/piece';

/** 一次翻棋事件：谁翻出了什么（引擎在动作应用后提供给绑定规则）。 */
export interface RevealEvent {
  /** 执行翻棋动作的玩家。 */
  readonly revealerId: PlayerId;
  /** 翻出的棋子颜色。 */
  readonly revealedColor: ColorId;
  /** 翻出的棋子类型（三人玩法的阵营由 (type, color) 共同决定）。 */
  readonly revealedType: PieceType;
}

/**
 * 阵营绑定规则：决定各玩家的 factionId 何时、如何被确定。
 *
 * 引擎在每次动作应用后调用（非翻棋动作 event 为 null），并用返回值替换玩家列表；
 * 是否绑定、把哪个阵营绑给谁，完全由玩法决定。引擎不假设玩家数、阵营数
 * 及其对应关系——“首次翻棋定阵营”等属于具体玩法规则（见 modes/dark-chess-4x8/rules.ts）。
 */
export interface FactionBindingRule {
  apply(state: GameState, event: RevealEvent | null): readonly Player[];
}

/**
 * 恒等绑定：不做任何事后绑定。
 * 适用于“阵营在开局即已确定”的玩法（玩家 factionId 由 createInitialState 直接赋值）。
 */
export function createStaticFactionBinding(): FactionBindingRule {
  return {
    apply(state) {
      return state.players;
    },
  };
}
