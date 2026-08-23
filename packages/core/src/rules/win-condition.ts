import type { Faction } from '../model/faction';
import type { ColorId, FactionId } from '../model/ids';
import type { GameState } from '../model/game-state';

/**
 * 胜负条件（需求十三/十四）。
 * 返回胜方阵营 id，或 null 表示尚未分出胜负。
 */
export interface WinCondition {
  evaluate(state: GameState): FactionId | null;
}

/**
 * 消灭胜负条件：某阵营棋子全被吃光即判负。
 * 当只剩一个阵营仍有棋子时返回该阵营；对未来多阵营玩法同样成立。
 */
export function createEliminationWinCondition(
  factions: readonly Faction[],
  factionForColor: (color: ColorId) => FactionId,
): WinCondition {
  return {
    evaluate(state) {
      const counts = new Map<FactionId, number>();
      for (const f of factions) counts.set(f.id, 0);
      for (const cell of state.board.cells) {
        const p = cell.piece;
        if (!p) continue;
        const f = factionForColor(p.color);
        counts.set(f, (counts.get(f) ?? 0) + 1);
      }
      const survivors = factions.filter((f) => (counts.get(f.id) ?? 0) > 0);
      if (survivors.length !== 1) return null;
      return survivors[0]?.id ?? null;
    },
  };
}
