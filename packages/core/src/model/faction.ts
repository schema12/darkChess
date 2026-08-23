import type { ColorId, FactionId } from './ids';

/**
 * 阵营/势力。
 * 当前玩法阵营与棋子颜色一一对应（RED/BLACK 各一色），
 * 但模型允许未来一个阵营拥有多个颜色（colors 数组），
 * 使“玩家”“阵营”“棋子颜色”可以解耦（需求二十三）。
 */
export interface Faction {
  readonly id: FactionId;
  readonly displayName: string;
  readonly colors: readonly ColorId[];
}
