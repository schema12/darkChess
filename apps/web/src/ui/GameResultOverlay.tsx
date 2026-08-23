import type { FactionId } from '@darkchess/core';
import type { GameController } from '../game/useGame';

function factionName(game: GameController, id: FactionId | null): string {
  if (id === null) return '待定';
  return game.mode.factions.find((f) => f.id === id)?.displayName ?? id;
}

/** 胜负原因从权威状态派生（不做文字猜测）。 */
function winReason(game: GameController, winner: FactionId): string {
  const loser = game.mode.factions.find((f) => f.id !== winner)?.id;
  if (loser === undefined) return '';
  const loserPieces = game.state.board.cells.filter(
    (c) => c.piece !== null && game.mode.factionForColor(c.piece.color) === loser,
  ).length;
  return loserPieces === 0 ? '对方棋子全部被吃光' : '对方无棋可走';
}

/** 中央结算 Overlay：胜负/和棋 + 原因 + 新对局。 */
export function GameResultOverlay({ game }: { game: GameController }) {
  const { state } = game;
  if (state.status.kind === 'inProgress') return null;

  let title: string;
  let reason: string;
  if (state.status.kind === 'won') {
    title = `${factionName(game, state.status.winner)}获胜`;
    reason = winReason(game, state.status.winner);
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
