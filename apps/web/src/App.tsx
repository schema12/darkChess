import { useGame } from './game/useGame';
import { BoardView } from './ui/BoardView';
import { DrawProgress } from './ui/DrawProgress';
import { GameResultOverlay } from './ui/GameResultOverlay';
import { StatusBar } from './ui/StatusBar';

export function App() {
  const game = useGame();
  return (
    <main className="app">
      <h1>DarkChess · 暗棋</h1>
      <StatusBar game={game} />
      <BoardView game={game} />
      <DrawProgress state={game.state} />
      <p className="hint">点击背面棋子翻棋；点击己方棋子选中，再点击高亮目标移动/吃子。</p>
      <GameResultOverlay game={game} />
    </main>
  );
}
