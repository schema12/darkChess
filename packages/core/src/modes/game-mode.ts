import type { ColorId, FactionId } from '../model/ids';
import type { GameState } from '../model/game-state';
import type { FactionPieceRef, PieceType } from '../model/piece';
import type { Faction } from '../model/faction';
import type { RuleSet } from '../rules/rule-set';

/** 初始棋子池中的一枚棋子的规格（类型 + 颜色）。 */
export interface PieceSpec {
  readonly type: PieceType;
  readonly color: ColorId;
}

export interface BoardConfig {
  readonly width: number;
  readonly height: number;
}

/**
 * 游戏模式抽象（需求十七/十八）。
 * 棋盘尺寸、棋子数量、初始布局、玩家人数、阵营关系、移动/吃子/胜负/和棋规则
 * 全部属于具体 GameMode；未来新增玩法只需实现该接口。
 * 动作校验/应用由通用 GameEngine 基于 ruleSet 完成，不属于 GameMode。
 */
export interface GameMode {
  readonly id: string;
  readonly name: string;
  readonly boardConfig: BoardConfig;
  readonly factions: readonly Faction[];
  readonly piecePool: readonly PieceSpec[];
  readonly ruleSet: RuleSet;

  /** 棋子（类型+颜色）-> 阵营。两人玩法只看颜色；三人玩法由 (type, color) 共同决定。 */
  factionOf(piece: FactionPieceRef): FactionId;

  /** 创建开局状态：随机打乱 + 全背面 + 玩家 A/B（阵营未定）。 */
  createInitialState(seed?: number): GameState;
}
