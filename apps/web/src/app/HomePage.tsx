/**
 * 首页 = 开始页：本地模式选择 + 联机入口 + Future 占位。
 * 本地入口点击直接进入 GamePage（不设中间选择页）。
 */
export function HomePage({
  onLocal,
  onOnline,
}: {
  onLocal: (players: '2p' | '3p') => void;
  onOnline: () => void;
}) {
  return (
    <div className="page">
      <h2 className="page-title">开始游戏</h2>

      <section className="home-group">
        <h3>本地游戏</h3>
        <div className="entry-grid">
          <button type="button" className="entry-card" onClick={() => onLocal('2p')}>
            <span className="entry-title">本地·两人</span>
            <span className="entry-desc">同一屏幕轮流操作</span>
          </button>
          <button type="button" className="entry-card" onClick={() => onLocal('3p')}>
            <span className="entry-title">本地·三人</span>
            <span className="entry-desc">三阵营 · 热座轮流</span>
          </button>
        </div>
      </section>

      <section className="home-group">
        <h3>联机</h3>
        <button type="button" className="entry-card wide" onClick={onOnline}>
          <span className="entry-title">联机对战</span>
          <span className="entry-desc">双人 / 三人房间 · 断线重连</span>
        </button>
      </section>

      <section className="home-group">
        <h3>快速开始</h3>
        <div className="placeholder-box">最近游戏（预留）</div>
      </section>
    </div>
  );
}
