import type { GameController } from '../game/useGame';

/**
 * 联机页：模式选择（双人 / 三人均可用，分别进入对应房间页）。
 */
export function OnlinePage({
  game,
  onEnter2p,
  onEnter3p,
  onEnterScan,
  onReturnToRoom,
}: {
  game: GameController;
  onEnter2p: () => void;
  onEnter3p: () => void;
  /** 扫码加入：进入加入页（含系统相机扫码指引与手动加入表单）。 */
  onEnterScan: () => void;
  /** 已有活动会话时显示“返回当前房间”。 */
  onReturnToRoom: (() => void) | null;
}) {
  const active = game.online !== null && game.online.playerId !== '' && game.online.status !== 'closed';
  return (
    <div className="page">
      <h2 className="page-title">联机游戏</h2>

      <div className="entry-grid">
        <button type="button" className="entry-card" onClick={onEnter2p}>
          <span className="entry-title">联机·双人</span>
          <span className="entry-desc">双人房间 · 立即进入</span>
        </button>
        <button type="button" className="entry-card" onClick={onEnter3p}>
          <span className="entry-title">联机·三人</span>
          <span className="entry-desc">三阵营房间 · 立即进入</span>
        </button>
        <button type="button" className="entry-card wide" onClick={onEnterScan}>
          <span className="entry-title">扫码加入房间</span>
          <span className="entry-desc">已有房间二维码？扫码直接加入</span>
        </button>
      </div>
      <p className="page-hint">
        双人/三人：使用相同的服务器地址与房间 ID 加入，人满自动开局。
      </p>

      {active && onReturnToRoom ? (
        <button type="button" className="entry-card wide return" onClick={onReturnToRoom}>
          <span className="entry-title">返回当前房间</span>
          <span className="entry-desc">
            房间 {game.online?.roomId} · 本机玩家 {game.online?.playerId}
          </span>
        </button>
      ) : null}
    </div>
  );
}
