import { useState } from 'react';
import type { GameController, ReadyGameController } from '../game/useGame';
import { modeDrawThresholds } from '../game/modeInfo';
import { friendlyConnectError } from './friendly';
import { BoardView } from './BoardView';
import { DrawProgress } from './DrawProgress';
import { EliminationNotices } from './EliminationNotices';
import { GameHeader } from './GameHeader';
import { GameResultOverlay } from './GameResultOverlay';
import { PlayerPanel } from './PlayerPanel';
import { Toast } from './Toast';

/** 权威状态就绪后的对局内容（不含 Header）。 */
function GameContent({ game, onExit }: { game: ReadyGameController; onExit: () => void }) {
  const online = game.online;
  const state = game.state;
  // 淘汰玩家的“继续观战”选择：仅本地 UI 态（会话/身份/淘汰状态不变）。
  const [spectating, setSpectating] = useState(false);
  const [confirmResign, setConfirmResign] = useState(false);
  const me = online ? (state.players.find((p) => p.id === online.playerId) ?? null) : null;
  const iAmOut = me?.eliminated === true;
  const viewerActive = online !== null && me !== null && me.eliminated !== true;
  const ownTurn =
    !online || online.playerId === '' || online.playerId === state.currentPlayerId;

  // 操作提示：按上下文切换（人话，不出现协议码）。
  let hint: string;
  if (iAmOut) {
    hint = spectating ? '你已被淘汰，正在观战' : '你已被淘汰';
  } else if (!ownTurn) {
    hint = `等待 玩家${state.currentPlayerId} 行动…`;
  } else if (game.selected) {
    hint = '点击高亮目标格移动或吃子';
  } else if (game.movablePieces.size > 0) {
    hint = '点击己方棋子选中，再点击目标格；也可以翻开一枚棋子';
  } else if (game.revealTargets.size > 0) {
    hint = '没有可移动的棋子，请翻开一枚';
  } else {
    hint = '等待局面更新…';
  }

  const current = state.players.find((p) => p.id === state.currentPlayerId);
  const faction = current?.factionId
    ? game.mode.factions.find((f) => f.id === current.factionId)?.displayName ?? current.factionId
    : '阵营待定';

  return (
    <>
      <PlayerPanel game={game} />
      <EliminationNotices
        notices={game.eliminationNotices}
        gameOver={state.status.kind !== 'inProgress'}
      />
      <Toast message={game.toast} />
      {iAmOut && !spectating ? (
        <div className="overlay">
          <div className="result-card">
            <h2>负</h2>
            <p className="reason">你已被淘汰</p>
            <div className="result-actions">
              <button type="button" onClick={() => setSpectating(true)}>
                观战
              </button>
              <button type="button" className="secondary" onClick={onExit}>
                退出房间
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <BoardView game={game} />
      {online && viewerActive && state.status.kind === 'inProgress' ? (
        <div className="in-game-actions">
          <button type="button" className="secondary-btn" onClick={() => setConfirmResign(true)}>
            认输
          </button>
          <button
            type="button"
            className="secondary-btn"
            disabled={game.myDrawCount >= 3 || game.pendingDrawFrom !== null}
            onClick={game.drawOffer ?? undefined}
          >
            求和{game.myDrawCount > 0 ? `（${game.myDrawCount}/3）` : ''}
          </button>
        </div>
      ) : null}
      <section className="game-status">
        <div className="gs-row">
          <span className="gs-turn">
            轮到 玩家{state.currentPlayerId}
            <span className="gs-faction">（{faction}）</span>
            {iAmOut && spectating ? <span className="spectate-badge">观战中</span> : null}
          </span>
          <span className="gs-meta">第 {state.turnNumber + 1} 手</span>
        </div>
        <div className="gs-hint">{hint}</div>
      </section>
      <DrawProgress state={state} thresholds={modeDrawThresholds(game.mode.id)} />
      {online ? (
        <p className="hint">
          联机中：房间 {online.roomId} · 本机玩家 {online.playerId}
        </p>
      ) : (
        <p className="hint">点击背面棋子翻棋；点击己方棋子选中，再点击高亮目标移动/吃子。</p>
      )}
      {confirmResign ? (
        <div className="overlay">
          <div className="result-card">
            <h2>认输</h2>
            <p className="reason">确定要认输吗？认输后你将被判负淘汰。</p>
            <div className="result-actions">
              <button type="button" onClick={game.resign ?? undefined}>
                认输
              </button>
              <button type="button" className="secondary" onClick={() => setConfirmResign(false)}>
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {online?.pendingDrawFrom ? (
        <div className="overlay">
          <div className="result-card">
            <h2>求和</h2>
            <p className="reason">玩家{online.pendingDrawFrom}请求和棋（计时不会暂停）</p>
            <div className="result-actions">
              <button type="button" onClick={() => game.drawResponse?.(true)}>
                同意
              </button>
              <button type="button" className="secondary" onClick={() => game.drawResponse?.(false)}>
                拒绝
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <GameResultOverlay
        game={game}
        onExit={onExit}
        viewerId={online?.playerId || undefined}
      />
    </>
  );
}

/**
 * GamePage：沉浸式对局页（无底部导航）。
 * 顶部 Header（返回 / 模式·房间 / 连接状态|设置）+ 玩家区 + 棋盘 + 状态区。
 * 联机等待开局与断线为整卡状态；本地模式直接进入对局内容。
 */
export function GameView({
  game,
  modeLabel,
  onExit,
  onSettings,
}: {
  game: GameController;
  modeLabel: string;
  onExit: () => void;
  onSettings: () => void;
}) {
  const online = game.online;

  // 断线：给出人话原因 + 重连/返回（座位与令牌保留在服务器）。
  if (online && online.status === 'closed') {
    return (
      <div className="game-screen">
        <GameHeader modeLabel={modeLabel} online={online} onExit={onExit} onSettings={onSettings} />
        <div className="lobby-card">
          <h2>连接已断开</h2>
          {online.lastError ? (
            <p className="lobby-error">{friendlyConnectError(online.lastError)}</p>
          ) : null}
          <p className="lobby-hint">
            你的座位与身份已保留在服务器，重连后恢复原座位继续对局。
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
      </div>
    );
  }

  // 联机等待开局。
  if (!game.state) {
    const seatList = online?.roomPlayers ?? [];
    return (
      <div className="game-screen">
        <GameHeader modeLabel={modeLabel} online={online} onExit={onExit} onSettings={onSettings} />
        <div className="lobby-card">
          <h2>等待其他玩家加入…</h2>
          <p className="lobby-hint">
            房间 <b>{online?.roomId ?? ''}</b> · 你是玩家 <b>{online?.playerId || '…'}</b>
          </p>
          {seatList.length > 0 ? (
            <ul className="seat-list">
              {seatList.map((p) => (
                <li key={p.playerId} className={p.connected ? 'seat on' : 'seat off'}>
                  <span className="dot">{p.connected ? '●' : '○'}</span>
                  {p.connected ? `玩家 ${p.playerId}` : '等待玩家'}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="lobby-hint">
            在其他设备的浏览器打开同一页面，填相同的服务器地址与房间 ID 即可加入。
          </p>
          {online?.lastError ? (
            <p className="lobby-error">{friendlyConnectError(online.lastError)}</p>
          ) : null}
          <div className="lobby-actions">
            <button type="button" className="secondary" onClick={onExit}>
              返回
            </button>
          </div>
        </div>
      </div>
    );
  }

  const resolved = game as ReadyGameController;
  return (
    <div className="game-screen">
      <GameHeader modeLabel={modeLabel} online={online} onExit={onExit} onSettings={onSettings} />
      <GameContent game={resolved} onExit={onExit} />
    </div>
  );
}
