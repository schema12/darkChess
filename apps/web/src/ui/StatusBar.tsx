import type { FactionId } from '@darkchess/core';
import type { GameController } from '../game/useGame';

function factionName(game: GameController, id: FactionId | null): string {
  if (id === null) return '待定';
  return game.mode.factions.find((f) => f.id === id)?.displayName ?? id;
}

export function StatusBar({ game }: { game: GameController }) {
  const { state, phase, newGame } = game;

  let text = '';
  if (phase === 'PLAYING') {
    const cur = state.players.find((p) => p.id === state.currentPlayerId);
    text = `轮到 ${factionName(game, cur?.factionId ?? null)} · 第 ${state.turnNumber + 1} 手`;
  }

  return (
    <div className="statusbar">
      <span className="status-text">{text}</span>
      <button type="button" onClick={newGame}>
        新对局
      </button>
    </div>
  );
}
