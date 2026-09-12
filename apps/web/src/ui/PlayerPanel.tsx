import type { ReadyGameController } from '../game/useGame';

function fmt(sec: number): string {
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

/**
 * 玩家状态卡片（对战 UI 核心）：
 * 头像 + 玩家身份 + 阵营 + 回合状态 + 倒计时，全部绑定在同一张卡上——
 * 当前行动玩家明显高亮，≤10s 危险脉动只出现在其卡内；N 玩家自适应（2P/3P）。
 * 只展示公开状态，不泄露任何未翻棋子的类型/颜色/归属。
 */
export function PlayerPanel({ game }: { game: ReadyGameController }) {
  const { state, mode, online, turnRemainingSec, turnPolicySec } = game;
  const isTimed = turnPolicySec !== null; // 联机计时房（本地/不限时无计时器）
  const viewerId = online?.playerId ?? null;
  const hostId = online?.roomPlayers.find((p) => p.isHost)?.playerId ?? null;

  return (
    <div className={`player-panel players-${state.players.length}`}>
      {state.players.map((p) => {
        const isCurrent = state.status.kind === 'inProgress' && p.id === state.currentPlayerId;
        const isViewer = online !== null && p.id === viewerId;
        const faction = p.factionId
          ? mode.factions.find((f) => f.id === p.factionId)?.displayName ?? p.factionId
          : '阵营待定';
        const out = p.eliminated === true;
        // 断线：联机房间内该座位离线（计时继续——服务器不因断线暂停回合）。
        const disconnected =
          online !== null &&
          online.roomPlayers.find((rp) => rp.playerId === p.id)?.connected === false;
        // 倒计时绑定玩家：当前行动者显示实时剩余，其余玩家显示满额（时钟未走）。
        const timerSec = isCurrent ? turnRemainingSec : turnPolicySec;
        // 危险脉动仅属于真实倒计时（1-10s）；本地归零后、权威结算到达前的 00:00
        // 是过渡态，不闪烁——新回合的计时由权威广播原子重置，绝不继承旧 00:00。
        const danger = isCurrent && timerSec !== null && timerSec <= 10 && timerSec > 0;
        const status = out
          ? '已淘汰'
          : disconnected
            ? '断线'
            : isCurrent
              ? isViewer
                ? '你的回合'
                : '行动中'
              : '等待中';

        const cls = ['pcard', isCurrent ? 'current' : '', out ? 'out' : '', danger ? 'danger' : '']
          .filter(Boolean)
          .join(' ');

        return (
          <div key={p.id} className={cls}>
            <div className="pcard-avatar">{p.id}</div>
            <div className="pcard-body">
              <span className="pcard-name">
                玩家{p.id}
                {isViewer ? '（你）' : ''}
                {p.id === hostId ? <span className="pcard-host">房主</span> : null}
              </span>
              <span className="pcard-faction">{faction}</span>
              <span className="pcard-status">{status}</span>
            </div>
            {isTimed && !out && timerSec !== null ? (
              <div className={`pcard-timer${danger ? ' urgent' : ''}`}>{fmt(timerSec)}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
