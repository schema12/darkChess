import { useCallback, useMemo, useRef, useState } from 'react';
import {
  createDarkChess4x8Mode,
  createEngine,
  pieceAt,
} from '@darkchess/core';
import type { GameAction, GameMode, GameState, Position } from '@darkchess/core';
import { soundManager } from '../audio/soundManager';

/**
 * 显式的对局阶段：PLAYING / WON / DRAW。
 * 由权威来源 GameState.status 派生，UI 不通过文字猜测游戏是否结束。
 */
export type GamePhase = 'PLAYING' | 'WON' | 'DRAW';

export interface GameController {
  mode: GameMode;
  state: GameState;
  phase: GamePhase;
  selected: Position | null;
  /** 可翻棋位置（"x,y"）。 */
  revealTargets: ReadonlySet<string>;
  /** 当前选中棋子的可移动目标（"x,y"）。 */
  selectedMoveTargets: ReadonlySet<string>;
  /** 拥有合法移动的己方棋子位置（"x,y"）。 */
  movablePieces: ReadonlySet<string>;
  clickCell: (x: number, y: number) => void;
  newGame: () => void;
}

function phaseOf(state: GameState): GamePhase {
  switch (state.status.kind) {
    case 'inProgress':
      return 'PLAYING';
    case 'won':
      return 'WON';
    case 'drawn':
      return 'DRAW';
  }
}

export function useGame(): GameController {
  const mode = useMemo(() => createDarkChess4x8Mode(), []);
  const engine = useMemo(() => createEngine(mode), [mode]);
  const [state, setState] = useState(() => mode.createInitialState());
  const stateRef = useRef(state);
  const [selected, setSelected] = useState<Position | null>(null);

  const setGameState = useCallback((next: GameState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const apply = useCallback(
    (action: GameAction) => {
      const prev = stateRef.current;
      if (prev.status.kind !== 'inProgress') return;
      if (!engine.validate(prev, action).legal) return;
      const next = engine.apply(prev, action);

      const wasCapture =
        action.kind === 'move' && pieceAt(prev.board, action.to) !== null;
      soundManager.play(action.kind === 'reveal' ? 'reveal' : wasCapture ? 'capture' : 'move');
      if (next.status.kind === 'won') soundManager.play('win');
      else if (next.status.kind === 'drawn') soundManager.play('draw');

      setGameState(next);
    },
    [engine, setGameState],
  );

  const { revealTargets, movablePieces, moveByFrom } = useMemo(() => {
    const reveal = new Set<string>();
    const movable = new Set<string>();
    const moves = new Map<string, Position[]>();
    for (const a of engine.getLegalActions(state)) {
      if (a.kind === 'reveal') {
        reveal.add(`${a.position.x},${a.position.y}`);
      } else {
        const from = `${a.from.x},${a.from.y}`;
        movable.add(from);
        const list = moves.get(from) ?? [];
        list.push(a.to);
        moves.set(from, list);
      }
    }
    return { revealTargets: reveal, movablePieces: movable, moveByFrom: moves };
  }, [engine, state]);

  const selectedMoveTargets = useMemo(() => {
    if (!selected) return new Set<string>();
    const list = moveByFrom.get(`${selected.x},${selected.y}`) ?? [];
    return new Set(list.map((p) => `${p.x},${p.y}`));
  }, [selected, moveByFrom]);

  const clickCell = useCallback(
    (x: number, y: number) => {
      if (stateRef.current.status.kind !== 'inProgress') return;
      const key = `${x},${y}`;
      if (selected && selectedMoveTargets.has(key)) {
        apply({ kind: 'move', from: selected, to: { x, y } });
        setSelected(null);
        return;
      }
      if (revealTargets.has(key)) {
        apply({ kind: 'reveal', position: { x, y } });
        setSelected(null);
        return;
      }
      if (movablePieces.has(key)) {
        setSelected({ x, y });
        return;
      }
      setSelected(null);
    },
    [selected, selectedMoveTargets, revealTargets, movablePieces, apply],
  );

  const newGame = useCallback(() => {
    setGameState(mode.createInitialState());
    setSelected(null);
  }, [mode, setGameState]);

  const phase = phaseOf(state);

  return {
    mode,
    state,
    phase,
    selected,
    revealTargets,
    selectedMoveTargets,
    movablePieces,
    clickCell,
    newGame,
  };
}
