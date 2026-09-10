import type { GameController, ReadyGameController } from '../game/useGame';

/**
 * 三名（或两名）玩家的公开状态面板：
 * 座位、当前回合高亮、已绑定阵营（公开信息）、已淘汰标记。
 * 只展示公共状态——不泄露任何未翻开棋子的类型/颜色/归属。
 */
export function PlayerPanel({ game }: { game: ReadyGameController }) {
  const { state, mode } = game;
  const playing = state.status.kind === 'inProgress';

  return (
    <div className="player-panel">
      {state.players.map((p) => {
        const isCurrent = playing && p.id === state.currentPlayerId;
        const faction = p.factionId
          ? mode.factions.find((f) => f.id === p.factionId)?.displayName ?? p.factionId
          : '阵营待定';
        return (
          <div
            key={p.id}
            className={[
              'player-card',
              isCurrent ? 'current' : '',
              p.eliminated === true ? 'eliminated' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <span className="player-name">玩家{p.id}</span>
            <span className="player-faction">{faction}</span>
            {p.eliminated === true ? <span className="player-out">已淘汰</span> : null}
          </div>
        );
      })}
    </div>
  );
}
