import type { FactionId } from '@darkchess/core';
import type { GameController } from '../game/useGame';

function factionName(game: GameController, id: FactionId | null): string {
  if (id === null) return '待定';
  return game.mode.factions.find((f) => f.id === id)?.displayName ?? id;
}

/**
 * 胜负原因从权威状态派生，不假设玩家数量：
 * 胜者即棋盘上唯一存留阵营，其余阵营棋子已全部离场（被吃光或随淘汰退出）。
 */
function winReason(game: GameController, winner: FactionId): string {
  const loserPieces = game.state.board.cells.filter(
    (c) => c.piece !== null && game.mode.factionOf(c.piece) !== winner,
  ).length;
  return loserPieces === 0 ? '其余阵营棋子已全部被消灭' : '其余阵营已无棋可走';
}

/** 中央结算 Overlay：胜负/和棋 + 原因 + 新对局。 */
export function GameResultOverlay({ game }: { game: GameController }) {
  const { state } = game;
  if (state.status.kind === 'inProgress') return null;

  let title: string;
  let reason: string;
  if (state.status.kind === 'won') {
    const winnerFaction = state.status.winner;
    if (state.status.winnerPlayerId !== undefined) {
      // 玩家判据胜负（多人玩法：仅剩一名未淘汰玩家）。
      const faction = winnerFaction !== null ? factionName(game, winnerFaction) : null;
      title = `玩家${state.status.winnerPlayerId}获胜${faction ? `（${faction}）` : ''}`;
      reason = '其余玩家均已判负淘汰';
    } else if (winnerFaction !== null) {
      // 阵营判据胜负（棋盘上只剩该阵营的棋子）。
      title = `${factionName(game, winnerFaction)}获胜`;
      reason = winReason(game, winnerFaction);
    } else {
      title = '对局结束';
      reason = '';
    }
  } else {
    title = '和棋';
    reason =
      state.status.reason.kind === 'noCapture'
        ? `连续 ${state.status.reason.threshold} 步未发生吃子`
        : `重复局面达到 ${state.status.reason.count} 次`;
  }

  return (
    <div className="overlay">
      <div className="result-card">
        <h2>{title}</h2>
        <p className="reason">{reason}</p>
        <button type="button" onClick={game.newGame}>
          新对局
        </button>
      </div>
    </div>
  );
}
