import type { EliminationNotice } from '../game/useGame';

/**
 * 淘汰通知横幅：对所有玩家可见、原因明确、无需点击确认、不阻塞下一回合，
 * 且视觉上独立于最终胜负/和棋的结算浮层。
 */
export function EliminationNotices({ notices }: { notices: readonly EliminationNotice[] }) {
  if (notices.length === 0) return null;
  return (
    <div className="elimination-notices">
      {notices.map((n) => (
        <span key={n.playerId} className="elimination-notice">
          {n.reason === 'timeout' ? '⏱' : '⚠️'} 玩家{n.playerId}
          {n.reason === 'timeout' ? '操作超时' : '无合法行动'}
          ，已判负并淘汰
        </span>
      ))}
    </div>
  );
}
