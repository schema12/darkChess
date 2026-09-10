import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createDarkChess4x8Mode,
  createDarkChess3p4x8Mode,
  createEngine,
  createLocalSession,
  pieceAt,
} from '@darkchess/core';
import type {
  GameAction,
  GameMode,
  GameState,
  GameSession,
  PlayerId,
  Position,
} from '@darkchess/core';
import { soundManager } from '../audio/soundManager';

/**
 * 显式的对局阶段：PLAYING / WON / DRAW。
 * 由权威来源 GameState.status 派生，UI 不通过文字猜测游戏是否结束。
 */
export type GamePhase = 'PLAYING' | 'WON' | 'DRAW';

/** 淘汰通知：'noLegalAction' 来自本地权威结算；'timeout' 为在线模式预留原因。 */
export type EliminationNotice = {
  playerId: PlayerId;
  reason: 'noLegalAction' | 'timeout';
};

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
  /** 本局累计的淘汰通知（按淘汰发生顺序）。 */
  eliminationNotices: readonly EliminationNotice[];
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

/** 会话是状态的唯一来源：订阅权威更新（未来远程会话走同一条路径）。 */
export function useGame(createMode: () => GameMode = createDarkChess4x8Mode): GameController {
  const mode = useMemo(() => createMode(), [createMode]);
  // engine 只用于视图推导（合法动作高亮），不再是状态的最终执行者；
  // 状态转移统一经由 session 提交，由权威方（当前为本地会话）校验并应用。
  const viewEngine = useMemo(() => createEngine(mode), [mode]);

  const [epoch, setEpoch] = useState(0); // newGame = 重建会话
  const session = useMemo(() => createLocalSession(mode), [mode, epoch]);
  const [state, setState] = useState<GameState>(() => session.getState());
  const stateRef = useRef(state);
  const [selected, setSelected] = useState<Position | null>(null);
  const [notices, setNotices] = useState<readonly EliminationNotice[]>([]);

  const applyState = useCallback((next: GameState) => {
    const prev = stateRef.current;
    if (prev !== next) {
      // 淘汰通知：对比前后状态的 eliminated 标记，对所有玩家可见、无需确认、
      // 不阻塞下一回合。本地会话下淘汰只可能来自“无合法行动判负”；
      // 'timeout' 为在线模式预留原因（未来由服务端在状态/事件中显式携带）。
      const fresh: EliminationNotice[] = [];
      for (const p of next.players) {
        const before = prev.players.find((q) => q.id === p.id);
        if (p.eliminated === true && before?.eliminated !== true) {
          fresh.push({ playerId: p.id, reason: 'noLegalAction' });
        }
      }
      if (fresh.length > 0) setNotices((list) => [...list, ...fresh]);
    }
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    setNotices([]);
    applyState(session.getState());
    return session.subscribe(applyState);
  }, [session, applyState]);

  const submitAction = useCallback(
    (action: GameAction) => {
      const prev = stateRef.current;
      if (prev.status.kind !== 'inProgress') return;
      const wasCapture = action.kind === 'move' && pieceAt(prev.board, action.to) !== null;
      // 单机热座：UI 以“当前回合玩家”的名义提交；联机后改为登录座位的玩家 id，
      // 由权威方校验发送者与回合一致性。
      const outcome = session.submit({ playerId: prev.currentPlayerId, action });
      if (outcome.kind !== 'accepted') return;
      soundManager.play(action.kind === 'reveal' ? 'reveal' : wasCapture ? 'capture' : 'move');
      if (outcome.state.status.kind === 'won') soundManager.play('win');
      else if (outcome.state.status.kind === 'drawn') soundManager.play('draw');
    },
    [session],
  );

  const { revealTargets, movablePieces, moveByFrom } = useMemo(() => {
    const reveal = new Set<string>();
    const movable = new Set<string>();
    const moves = new Map<string, Position[]>();
    for (const a of viewEngine.getLegalActions(state)) {
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
  }, [viewEngine, state]);

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
        submitAction({ kind: 'move', from: selected, to: { x, y } });
        setSelected(null);
        return;
      }
      if (revealTargets.has(key)) {
        submitAction({ kind: 'reveal', position: { x, y } });
        setSelected(null);
        return;
      }
      if (movablePieces.has(key)) {
        setSelected({ x, y });
        return;
      }
      setSelected(null);
    },
    [selected, selectedMoveTargets, revealTargets, movablePieces, submitAction],
  );

  const newGame = useCallback(() => {
    setEpoch((e) => e + 1);
    setSelected(null);
  }, []);

  const phase = phaseOf(state);

  return {
    mode,
    state,
    phase,
    selected,
    revealTargets,
    selectedMoveTargets,
    movablePieces,
    eliminationNotices: notices,
    clickCell,
    newGame,
  };
}
