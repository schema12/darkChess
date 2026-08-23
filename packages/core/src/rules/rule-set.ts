import type { PieceType } from '../model/piece';
import type { CaptureRule } from './capture';
import type { DrawCondition } from './draw-condition';
import type { MovementRule } from './movement';
import type { RevealRule } from './reveal';
import type { WinCondition } from './win-condition';

/**
 * 玩法相关的规则集合，全部由具体 GameMode 提供。
 * 通用引擎不感知具体规则，只调用 RuleSet（需求十七/十八）。
 */
export interface RuleSet {
  readonly capture: CaptureRule;
  readonly movement: ReadonlyMap<PieceType, MovementRule>;
  readonly reveal: RevealRule;
  readonly winConditions: readonly WinCondition[];
  readonly drawConditions: readonly DrawCondition[];
}
