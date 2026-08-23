import {
  NO_CAPTURE_DRAW_THRESHOLD,
  REPETITION_DRAW_THRESHOLD,
} from '@darkchess/core';
import type { GameState } from '@darkchess/core';

/** 和棋进度提示：连续未吃子 / 重复局面。 */
export function DrawProgress({ state }: { state: GameState }) {
  if (state.status.kind !== 'inProgress') return null;

  const repCount = state.actionLog.filter((r) => r.repetitionKey === state.repetitionKey).length;
  const remaining = NO_CAPTURE_DRAW_THRESHOLD - state.noCaptureCount;
  const near = state.noCaptureCount > 0 && remaining <= 5;

  return (
    <div className="draw-progress">
      <span className={near ? 'near' : ''}>
        连续未吃子：{state.noCaptureCount} / {NO_CAPTURE_DRAW_THRESHOLD}
        {near ? ' · 即将和棋' : ''}
      </span>
      {repCount >= 2 ? (
        <span>
          重复局面：{repCount} / {REPETITION_DRAW_THRESHOLD}
        </span>
      ) : null}
    </div>
  );
}
