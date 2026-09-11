import type { FactionId } from '@darkchess/core';
import type { GameController, ReadyGameController } from '../game/useGame';

function factionName(game: GameController, id: FactionId | null): string {
  if (id === null) return '待定';
  return game.mode.factions.find((f) => f.id === id)?.displayName ?? id;
}

/**
 * 胜负原因从权威状态派生，不假设玩家数量：
 * 胜者即棋盘上唯一存留阵营，其余阵营棋子已全部离场（被吃光或随淘汰退出）。
 */
function winReason(game: ReadyGameController, winner: FactionId): string {
  const loserPieces = game.state.board.cells.filter(
    (c) => c.piece !== null && game.mode.factionOf(c.piece) !== winner,
  ).length;
  return loserPieces === 0 ? '其余阵营棋子已全部被消灭' : '其余阵营已无棋可走';
}

/** 获胜者描述：优先玩家（含阵营），否则阵营。 */
function winnerLabel(game: ReadyGameController, status: { winner: FactionId | null; winnerPlayerId?: string }): string {
  if (status.winnerPlayerId !== undefined) {
    const faction = status.winner !== null ? factionName(game, status.winner) : null;
    return `玩家${status.winnerPlayerId}${faction ? `（${faction}）` : ''}`;
  }
  return status.winner !== null ? factionName(game, status.winner) : '未知';
}

/**
 * 中央结算 Overlay：按查看者身份个性化（联机）——胜利 / 失败 / 已淘汰；
 * 本地热座无单一查看者身份，保持中性展示。
 */
export function GameResultOverlay({
  game,
  onExit,
  viewerId,
}: {
  game: ReadyGameController;
  onExit?: () => void;
  /** 当前客户端对应的玩家 id（联机）；缺省为本地热座中性展示。 */
  viewerId?: string;
}) {
  const { state } = game;
  if (state.status.kind === 'inProgress') return null;

  const viewer =
    viewerId !== undefined ? (state.players.find((p) => p.id === viewerId) ?? null) : null;
  const viewerWon =
    state.status.kind === 'won' &&
    viewer !== null &&
    (state.status.winnerPlayerId !== undefined
      ? state.status.winnerPlayerId === viewer.id
      : state.status.winner !== null && viewer.factionId === state.status.winner);
  const viewerOut = viewer?.eliminated === true;

  let title: string;
  let reason: string;
  if (state.status.kind === 'won') {
    if (viewer !== null) {
      if (viewerWon) {
        title = '胜利';
        reason =
          state.status.winner !== null
            ? `获胜阵营：${factionName(game, state.status.winner)}`
            : '你是最后一名未淘汰玩家';
      } else if (viewerOut) {
        // 已淘汰玩家：不显示为普通“失败”。
        title = '已淘汰';
        reason = `本局获胜者：${winnerLabel(game, state.status)}`;
      } else {
        title = '失败';
        reason = `获胜者：${winnerLabel(game, state.status)}`;
      }
    } else if (state.status.winnerPlayerId !== undefined) {
      // 玩家判据胜负（多人玩法：仅剩一名未淘汰玩家）。
      const faction = state.status.winner !== null ? factionName(game, state.status.winner) : null;
      title = `玩家${state.status.winnerPlayerId}获胜${faction ? `（${faction}）` : ''}`;
      reason = '其余玩家均已判负淘汰';
    } else if (state.status.winner !== null) {
      // 阵营判据胜负（棋盘上只剩该阵营的棋子）。
      title = `${factionName(game, state.status.winner)}获胜`;
      reason = winReason(game, state.status.winner);
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
        <div className="result-actions">
          {/* 联机模式没有“新对局”：房间生命周期由服务器管理。 */}
          {game.online === null ? (
            <button type="button" onClick={game.newGame}>
              新对局
            </button>
          ) : null}
          {onExit ? (
            <button type="button" className="secondary" onClick={onExit}>
              返回
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
