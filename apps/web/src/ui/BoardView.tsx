import { cellAt } from '@darkchess/core';
import { assetRegistry } from '../assets/registry';
import type { GameController } from '../game/useGame';
import { PieceView } from './PieceView';

/**
 * 棋盘展示。
 * core 棋盘为 4 宽 × 8 高；这里以“横向 8 列 × 4 行”展示，
 * 仅做 UI 坐标映射（core (x, y) -> 展示 col = y, row = x），
 * 不改变 core 的坐标与规则语义，点击回传的仍是 core 坐标。
 */
export function BoardView({ game }: { game: GameController }) {
  const { state, phase, selected, revealTargets, selectedMoveTargets, movablePieces, clickCell } =
    game;
  const ended = phase !== 'PLAYING';

  const displayCols = state.board.height; // 8 列（横向）
  const displayRows = state.board.width; // 4 行

  // 按展示顺序（row-major）列出 core 坐标。
  const order: { x: number; y: number }[] = [];
  for (let row = 0; row < displayRows; row++) {
    for (let col = 0; col < displayCols; col++) {
      order.push({ x: row, y: col });
    }
  }

  return (
    <div
      className={`board${ended ? ' ended' : ''}`}
      style={{
        backgroundImage: `url("${assetRegistry.board(displayCols, displayRows)}")`,
        gridTemplateColumns: `repeat(${displayCols}, var(--cell-size))`,
      }}
    >
      {order.map(({ x, y }) => {
        const cell = cellAt(state.board, { x, y });
        const key = `${x},${y}`;
        const cls = ['cell'];
        if (selected?.x === x && selected?.y === y) cls.push('selected');
        if (selectedMoveTargets.has(key)) cls.push('move-target');
        if (revealTargets.has(key)) cls.push('reveal-target');
        if (movablePieces.has(key)) cls.push('movable');
        return (
          <div key={key} className={cls.join(' ')} onClick={() => clickCell(x, y)}>
            {cell?.piece ? <PieceView piece={cell.piece} /> : null}
          </div>
        );
      })}
    </div>
  );
}
