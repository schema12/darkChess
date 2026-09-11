import {
  NO_CAPTURE_DRAW_THRESHOLD,
  REPETITION_DRAW_THRESHOLD,
  THREE_PLAYER_DRAW_THRESHOLDS,
} from '@darkchess/core';

export interface DrawThresholds {
  readonly noCapture: number;
  readonly repetition: number;
}

/** 按当前玩法读取和棋阈值（修复通用 UI 硬编码 2P 常量的问题）。 */
export function modeDrawThresholds(modeId: string): DrawThresholds {
  if (modeId === 'dark-chess-3p-4x8') return THREE_PLAYER_DRAW_THRESHOLDS;
  return { noCapture: NO_CAPTURE_DRAW_THRESHOLD, repetition: REPETITION_DRAW_THRESHOLD };
}
