import type { OnlineInfo } from '../game/useGame';

/** 对局页顶部 Header：返回 / 模式·房间 / 连接状态或设置。 */
export function GameHeader({
  modeLabel,
  online,
  onExit,
  onSettings,
}: {
  modeLabel: string;
  online: OnlineInfo | null;
  onExit: () => void;
  onSettings: () => void;
}) {
  return (
    <header className="game-header">
      <button type="button" className="gh-back" onClick={onExit} aria-label="返回">
        ← 返回
      </button>
      <span className="gh-title">{modeLabel}</span>
      {online ? (
        <span className={`gh-conn ${online.status}`}>
          ● {online.status === 'closed'
            ? '已断开'
            : online.status === 'idle'
              ? '未连接'
              : online.status === 'connecting' || online.status === 'open'
                ? '连接中'
                : '已连接'}
        </span>
      ) : (
        <button type="button" className="gh-settings" onClick={onSettings} aria-label="设置">
          ⚙
        </button>
      )}
    </header>
  );
}
