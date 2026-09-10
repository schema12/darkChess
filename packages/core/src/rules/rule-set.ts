import type { PieceType } from '../model/piece';
import type { CaptureRule } from './capture';
import type { DrawCondition } from './draw-condition';
import type { FactionBindingRule } from './faction-binding';
import type { MovementRule } from './movement';
import type { RevealRule } from './reveal';
import type { StalemateRule } from './stalemate';
import type { WinCondition } from './win-condition';

/**
 * 玩法相关的规则集合，全部由具体 GameMode 提供。
 * 通用引擎不感知具体规则，只调用 RuleSet（需求十七/十八）。
 */
export interface RuleSet {
  readonly capture: CaptureRule;
  readonly movement: ReadonlyMap<PieceType, MovementRule>;
  readonly reveal: RevealRule;
  /** 阵营绑定：何时/如何确定玩家阵营完全由玩法决定（引擎不假设两人或阵营一一对应）。 */
  readonly factionBinding: FactionBindingRule;
  readonly winConditions: readonly WinCondition[];
  readonly drawConditions: readonly DrawCondition[];
  /** 僵局结算：当前玩家无合法动作时的处置，由玩法决定（结算顺序固定在胜负/和棋之后）。 */
  readonly stalemate: StalemateRule;
}
