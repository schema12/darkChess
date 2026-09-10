import { useMemo, useState } from 'react';
import {
  createDarkChess4x8Mode,
  createDarkChess3p4x8Mode,
} from '@darkchess/core';
import { useLocalGame, useOnlineGame } from './game/useGame';
import type { OnlineConnection } from './game/useGame';
import { ConnectionPanel } from './ui/ConnectionPanel';
import { GameView } from './ui/GameView';

type Screen =
  | { readonly kind: 'local'; readonly players: '2p' | '3p' }
  | { readonly kind: 'online-lobby' }
  | { readonly kind: 'online'; readonly connection: OnlineConnection };

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'local', players: '2p' });

  return (
    <main className="app">
      <h1>DarkChess · 暗棋</h1>
      <nav className="mode-switch">
        <button
          type="button"
          className={screen.kind === 'local' && screen.players === '2p' ? 'active' : ''}
          onClick={() => setScreen({ kind: 'local', players: '2p' })}
        >
          本地·两人
        </button>
        <button
          type="button"
          className={screen.kind === 'local' && screen.players === '3p' ? 'active' : ''}
          onClick={() => setScreen({ kind: 'local', players: '3p' })}
        >
          本地·三人
        </button>
        <button
          type="button"
          className={screen.kind === 'online-lobby' || screen.kind === 'online' ? 'active' : ''}
          onClick={() => setScreen({ kind: 'online-lobby' })}
        >
          联机·三人
        </button>
      </nav>

      {screen.kind === 'local' ? (
        <LocalGame players={screen.players} />
      ) : screen.kind === 'online-lobby' ? (
        <ConnectionPanel
          onConnect={(connection) => setScreen({ kind: 'online', connection })}
          onCancel={() => setScreen({ kind: 'local', players: '2p' })}
        />
      ) : (
        <OnlineGame connection={screen.connection} onExit={() => setScreen({ kind: 'online-lobby' })} />
      )}
    </main>
  );
}

function LocalGame({ players }: { players: '2p' | '3p' }) {
  // 工厂引用必须稳定（useMemo 依赖），否则模式/会话会随渲染重建。
  const createMode = useMemo(
    () => (players === '3p' ? createDarkChess3p4x8Mode : createDarkChess4x8Mode),
    [players],
  );
  const game = useLocalGame(createMode);
  return <GameView game={game} onExit={() => undefined} />;
}

function OnlineGame({
  connection,
  onExit,
}: {
  connection: OnlineConnection;
  onExit: () => void;
}) {
  const game = useOnlineGame('dark-chess-3p-4x8', connection);
  return <GameView game={game} onExit={onExit} />;
}
