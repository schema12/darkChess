import type { GameState } from '@darkchess/core';
import type { DrawThresholds } from '../game/modeInfo';

/** 和棋进度提示：连续未吃子 / 重复局面（阈值来自当前 GameMode 配置）。 */
export function DrawProgress({
  state,
  thresholds,
}: {
  state: GameState;
  thresholds: DrawThresholds;
}) {
  if (state.status.kind !== 'inProgress') return null;

  const repCount = state.actionLog.filter((r) => r.repetitionKey === state.repetitionKey).length;
  const remaining = thresholds.noCapture - state.noCaptureCount;
  const near = state.noCaptureCount > 0 && remaining <= 5;

  return (
    <div className="draw-progress">
      <span className={near ? 'near' : ''}>
        连续未吃子：{state.noCaptureCount} / {thresholds.noCapture}
        {near ? ' · 即将和棋' : ''}
      </span>
      {repCount >= 2 ? (
        <span>
          重复局面：{repCount} / {thresholds.repetition}
        </span>
      ) : null}
    </div>
  );
}
