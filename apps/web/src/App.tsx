import { useState } from 'react';
import { createDarkChess4x8Mode, createDarkChess3p4x8Mode } from '@darkchess/core';
import type { GameMode } from '@darkchess/core';
import { useGame } from './game/useGame';
import { BoardView } from './ui/BoardView';
import { DrawProgress } from './ui/DrawProgress';
import { EliminationNotices } from './ui/EliminationNotices';
import { GameResultOverlay } from './ui/GameResultOverlay';
import { PlayerPanel } from './ui/PlayerPanel';
import { StatusBar } from './ui/StatusBar';

const MODES: ReadonlyArray<{ key: string; label: string; create: () => GameMode }> = [
  { key: '2p', label: '两人', create: createDarkChess4x8Mode },
  { key: '3p', label: '三人', create: createDarkChess3p4x8Mode },
];

export function App() {
  const [modeKey, setModeKey] = useState('2p');
  const createMode = MODES.find((m) => m.key === modeKey)?.create ?? createDarkChess4x8Mode;
  const game = useGame(createMode);

  return (
    <main className="app">
      <h1>DarkChess · 暗棋</h1>
      <div className="mode-switch">
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            className={m.key === modeKey ? 'active' : ''}
            onClick={() => setModeKey(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <StatusBar game={game} />
      <PlayerPanel game={game} />
      <EliminationNotices notices={game.eliminationNotices} />
      <BoardView game={game} />
      <DrawProgress state={game.state} />
      <p className="hint">点击背面棋子翻棋；点击己方棋子选中，再点击高亮目标移动/吃子。</p>
      <GameResultOverlay game={game} />
    </main>
  );
}
