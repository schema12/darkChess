import type { GameAction } from '../model/action';
import type { GameState } from '../model/game-state';

/** 动作合法性结果：结构化原因供 UI 展示，规则修正只在引擎内进行。 */
export type MoveValidation =
  | { readonly legal: true }
  | { readonly legal: false; readonly reason: string };

export interface MoveValidator {
  validate(state: GameState, action: GameAction): MoveValidation;
}
