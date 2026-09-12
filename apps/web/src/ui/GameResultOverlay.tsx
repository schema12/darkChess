import type { FactionId } from '@darkchess/core';
import type { GameController, ReadyGameController } from '../game/useGame';

function factionName(game: GameController, id: FactionId | null): string {
  if (id === null) return '待定';
  return game.mode.factions.find((f) => f.id === id)?.displayName ?? id;
}

/** 获胜者描述：优先玩家（含阵营），否则阵营。 */
/** 淘汰通知 → 人话短语（用于胜利文案描述对手的结束原因）。 */
function eliminationPhrase(playerId: string, reason: 'noLegalAction' | 'timeout' | 'resign'): string {
  const who = `玩家${playerId}`;
  if (reason === 'timeout') return `${who}操作超时`;
  if (reason === 'resign') return `${who}已退出`;
  return `${who}无合法行动`;
}

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

  // 最终胜负 Overlay 只有大字：胜 / 负 / 和（原因属于局内事件提示，见淘汰横幅）。
  let title: '胜' | '负' | '和';
  if (state.status.kind === 'drawn') {
    title = '和';
  } else if (viewer === null) {
    title = '胜'; // 本地热座：设备持有者即刚获胜的一方
  } else if (viewerWon) {
    title = '胜';
  } else {
    title = '负';
  }
  // 胜者身份一行（非原因说明；原因已在局内横幅展示过）。
  let winnerLine = '';
  if (state.status.kind === 'won') {
    if (state.status.winnerPlayerId !== undefined) {
      const f = state.status.winner;
      winnerLine = `胜者：玩家${state.status.winnerPlayerId}${f !== null ? `（${factionName(game, f)}）` : ''}`;
    } else if (state.status.winner !== null) {
      winnerLine = `胜者：${factionName(game, state.status.winner)}`;
    }
  }

  const online = game.online;
  const canRematch = online !== null; // 联机 terminal → 再来一局（全员准备后开新局）
  const readyList = online?.rematchReady ?? [];
  const iAmReady = viewerId !== undefined && readyList.includes(viewerId);

    return (
    <div className="overlay">
      <div className="result-card">
        <div className={`result-mark${title === '和' ? ' draw' : ''}`}>{title}</div>
        {winnerLine ? <p className="reason">{winnerLine}</p> : null}
        <div className="result-actions">
          {online !== null ? (
            <button type="button" onClick={game.rematchReadyAction ?? undefined}>
              再来一局
            </button>
          ) : null}
          {online === null ? (
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
        {online !== null ? (
          <p className="rematch-ready">
            {state.players
              .map(
                (p) =>
                  `玩家${p.id}${readyList.includes(p.id) ? ' ✓' : online.playerId === p.id && !iAmReady ? '（等待你准备）' : ' 等待准备'}`,
              )
              .join(' · ')}
          </p>
        ) : null}
      </div>
    </div>
  );
}
