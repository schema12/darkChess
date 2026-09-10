import type { Faction } from '../model/faction';
import type { FactionId, PlayerId } from '../model/ids';
import type { GameState } from '../model/game-state';
import type { FactionPieceRef } from '../model/piece';

/**
 * 胜负判定结果：
 * - `faction`：以阵营为判据（棋盘上只剩该阵营的棋子）；
 * - `player`：以玩家为判据（多人玩法中仅剩一名未淘汰玩家），其可能尚未绑定阵营。
 */
export type WinOutcome =
  | { readonly kind: 'faction'; readonly winner: FactionId }
  | { readonly kind: 'player'; readonly winner: PlayerId };

/**
 * 胜负条件（需求十三/十四）。
 * 返回胜方判定，或 null 表示尚未分出胜负。
 */
export interface WinCondition {
  evaluate(state: GameState): WinOutcome | null;
}

/**
 * 消灭胜负条件：棋盘上只剩一个阵营的棋子时，该阵营获胜。
 * 以“棋盘剩余阵营”为判据（与玩家是否仍持子/是否被淘汰无关——被淘汰玩家的
 * 阵营棋子保留在棋盘上，仍参与本判定），对多阵营玩法同样成立。
 */
export function createEliminationWinCondition(
  factions: readonly Faction[],
  factionOf: (piece: FactionPieceRef) => FactionId,
): WinCondition {
  return {
    evaluate(state) {
      const counts = new Map<FactionId, number>();
      for (const f of factions) counts.set(f.id, 0);
      for (const cell of state.board.cells) {
        const p = cell.piece;
        if (!p) continue;
        const f = factionOf(p);
        counts.set(f, (counts.get(f) ?? 0) + 1);
      }
      const survivors = factions.filter((f) => (counts.get(f.id) ?? 0) > 0);
      if (survivors.length !== 1) return null;
      const winner = survivors[0];
      return winner ? { kind: 'faction', winner: winner.id } : null;
    },
  };
}

/**
 * 最后活跃玩家获胜条件（多人玩法）：当只剩一名未淘汰玩家时，该玩家立即获胜。
 * 由淘汰类事件（僵局判负 / 权威判负 forfeit）触发结算；胜负以玩家为判据，
 * 该玩家尚未绑定阵营时由引擎以 winnerPlayerId 表达。
 */
export function createLastActivePlayerWinCondition(): WinCondition {
  return {
    evaluate(state) {
      const active = state.players.filter((p) => p.eliminated !== true);
      if (active.length !== 1) return null;
      const winner = active[0];
      return winner ? { kind: 'player', winner: winner.id } : null;
    },
  };
}
