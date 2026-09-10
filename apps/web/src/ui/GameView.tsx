import type { GameController, ReadyGameController } from '../game/useGame';
import { BoardView } from './BoardView';
import { DrawProgress } from './DrawProgress';
import { EliminationNotices } from './EliminationNotices';
import { GameResultOverlay } from './GameResultOverlay';
import { PlayerPanel } from './PlayerPanel';
import { StatusBar } from './StatusBar';

/** state 已就绪的 GameController（联机等待开局时 state 为 null）。 */
type ResolvedGame = ReadyGameController;

/**
 * 对局视图：联机等待开局显示等待房间，断线显示重连入口；
 * 权威状态就绪后复用本地模式的全部展示组件。
 */
export function GameView({ game, onExit }: { game: GameController; onExit: () => void }) {
  const online = game.online;

  if (online && online.status === 'closed') {
    return (
      <div className="lobby-card">
        <h2>连接已断开</h2>
        {online.lastError ? <p className="lobby-error">{online.lastError}</p> : null}
        <p className="lobby-hint">
          你的座位与身份已保留在服务器（令牌保存在本机），重连后恢复原座位继续对局。
        </p>
        <div className="lobby-actions">
          <button type="button" onClick={game.reconnect ?? undefined}>
            重连
          </button>
          <button type="button" className="secondary" onClick={onExit}>
            返回
          </button>
        </div>
      </div>
    );
  }

  if (!game.state) {
    return (
      <div className="lobby-card">
        <h2>等待其他玩家加入…</h2>
        <p className="lobby-hint">
          房间 <b>{online?.roomId ?? ''}</b> · 你是玩家 <b>{online?.playerId || '…'}</b>
        </p>
        <p className="lobby-hint">
          在其他浏览器打开本页面，服务器填 <b>{online ? '相同地址' : ''}</b>、房间填相同 ID 加入。
          三名玩家到齐后自动开局。
        </p>
        {online && online.roomPlayers.length > 0 ? (
          <p className="lobby-hint">
            当前已入座：{online.roomPlayers.map((p) => `玩家${p.playerId}${p.connected ? '' : '（离线）'}`).join('、')}
          </p>
        ) : null}
        {online?.lastError ? <p className="lobby-error">{online.lastError}</p> : null}
        <div className="lobby-actions">
          <button type="button" className="secondary" onClick={onExit}>
            返回
          </button>
        </div>
      </div>
    );
  }

  const resolved = game as ResolvedGame;
  return (
    <>
      <StatusBar game={resolved} />
      <PlayerPanel game={resolved} />
      <EliminationNotices notices={game.eliminationNotices} />
      <BoardView game={resolved} />
      <DrawProgress state={resolved.state} />
      {online ? (
        <p className="hint">
          联机中：房间 {online.roomId} · 本机玩家 {online.playerId}
          {online.lastError ? ` · 上次操作被拒：${online.lastError}` : ''}
        </p>
      ) : (
        <p className="hint">点击背面棋子翻棋；点击己方棋子选中，再点击高亮目标移动/吃子。</p>
      )}
      <GameResultOverlay game={resolved} />
    </>
  );
}
