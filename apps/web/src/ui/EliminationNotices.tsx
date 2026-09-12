import type { EliminationNotice } from '../game/useGame';

/**
 * 淘汰通知横幅：对所有玩家可见、原因明确、无需点击确认、不阻塞下一回合，
 * 且视觉上独立于最终胜负/和棋的结算浮层。
 * 对局仍在继续时明确“游戏继续”；对局已终局时为“已判负并淘汰”。
 */
export function EliminationNotices({
  notices,
  gameOver,
}: {
  notices: readonly EliminationNotice[];
  gameOver: boolean;
}) {
  if (notices.length === 0) return null;
  return (
    <div className="elimination-notices">
      {notices.map((n) => (
        <span key={n.playerId} className="elimination-notice">
          {n.reason === 'timeout'
            ? `⏱ 玩家${n.playerId}操作超时，${gameOver ? '已判负并淘汰' : '判负，游戏继续'}`
            : n.reason === 'resign'
              ? `玩家${n.playerId}认输，${gameOver ? '已判负并淘汰' : '游戏继续'}`
              : `⚠️ 玩家${n.playerId}无合法行动，${gameOver ? '已判负并淘汰' : '判负，游戏继续'}`}
        </span>
      ))}
    </div>
  );
}
