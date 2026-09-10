import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createDarkChess4x8Mode,
  createDarkChess3p4x8Mode,
  createEngine,
  createLocalSession,
  pieceAt,
} from '@darkchess/core';
import {
  connectWebSocketGameSession,
} from '@darkchess/server/client';
import type { WebSocketGameSession } from '@darkchess/server/client';
import type { RoomPlayerInfo } from '@darkchess/server/protocol';
import type { ConnectionStatus } from '@darkchess/server/client';
import type {
  GameAction,
  GameMode,
  GameState,
  GameSession,
  Position,
} from '@darkchess/core';
import { soundManager } from '../audio/soundManager';

/**
 * 显式的对局阶段：PLAYING / WON / DRAW。
 * 由权威来源 GameState.status 派生，UI 不通过文字猜测游戏是否结束。
 */
export type GamePhase = 'PLAYING' | 'WON' | 'DRAW';

/** 淘汰通知原因：'noLegalAction'/'timeout' 来自服务器声明；'resign' 为认输。 */
export type EliminationReasonUi = 'noLegalAction' | 'timeout' | 'resign';

export interface EliminationNotice {
  playerId: string;
  reason: EliminationReasonUi;
}

export type OnlineStatus = 'connecting' | 'open' | 'closed' | 'waiting' | 'playing';

/** 联机会话的公开信息（全部来自服务器，客户端不自行推断）。 */
export interface OnlineInfo {
  status: OnlineStatus;
  playerId: string;
  roomId: string;
  token: string;
  roomPlayers: readonly RoomPlayerInfo[];
  lastError: string | null;
}

/** 权威状态已就绪的控制器（联机等待开局时不渲染对局视图）。 */
export interface ReadyGameController extends GameController {
  state: GameState;
}

export interface GameController {
  mode: GameMode;
  /** 权威状态：联机等待开局时为 null（显示等待界面，不显示棋盘）。 */
  state: GameState | null;
  phase: GamePhase;
  selected: Position | null;
  revealTargets: ReadonlySet<string>;
  selectedMoveTargets: ReadonlySet<string>;
  movablePieces: ReadonlySet<string>;
  eliminationNotices: readonly EliminationNotice[];
  clickCell: (x: number, y: number) => void;
  newGame: () => void;
  /** 联机信息（仅 online 模式有效）。 */
  online: OnlineInfo | null;
  /** 联机重连（使用保存的令牌恢复原座位）。 */
  reconnect: (() => void) | null;
  close: (() => void) | null;
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

/**
 * 本地热座（LocalSession，同步权威）与联机（WebSocketGameSession，异步权威）
 * 的统一前端控制器。
 *
 * 权威边界：本地模式下引擎结算由 LocalSession 执行；联机模式下一切状态来自
 * 服务器广播（客户端引擎只做合法动作高亮的只读推导），点击只负责 submit。
 */
export function useLocalGame(createMode: () => GameMode): GameController {
  const mode = useMemo(() => createMode(), [createMode]);
  const viewEngine = useMemo(() => createEngine(mode), [mode]);
  const session = useMemo(() => createLocalSession(mode), [mode]);
  const [state, setState] = useState<GameState>(() => session.getState());
  const stateRef = useRef(state);
  const [selected, setSelected] = useState<Position | null>(null);
  const [notices, setNotices] = useState<readonly EliminationNotice[]>([]);

  const applyState = useCallback((prev: GameState | null, next: GameState) => {
    if (prev !== next && prev !== null) {
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
    applyState(stateRef.current, session.getState());
    return session.subscribe((next) => applyState(stateRef.current, next));
  }, [session, applyState]);

  const submitAction = useCallback(
    (action: GameAction) => {
      const prev = stateRef.current;
      if (prev.status.kind !== 'inProgress') return;
      const wasCapture = action.kind === 'move' && pieceAt(prev.board, action.to) !== null;
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
      const current = stateRef.current;
      if (!current || current.status.kind !== 'inProgress') return;
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
    setSelected(null);
  }, []);

  return {
    mode,
    state,
    phase: phaseOf(state),
    selected,
    revealTargets,
    selectedMoveTargets,
    movablePieces,
    eliminationNotices: notices,
    clickCell,
    newGame,
    online: null,
    reconnect: null,
    close: null,
  };
}

export interface OnlineConnection {
  url: string;
  roomId: string;
  /** 初始重连令牌（缺省尝试 localStorage 中保存的令牌）。 */
  token?: string;
}

function storedTokenKey(url: string, roomId: string): string {
  return `darkchess:ws:${url}:${roomId}`;
}

function loadStoredToken(url: string, roomId: string): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage.getItem(storedTokenKey(url, roomId)) ?? undefined;
  } catch {
    return undefined;
  }
}

function saveStoredToken(url: string, roomId: string, token: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storedTokenKey(url, roomId), token);
  } catch {
    // 存储不可用时静默降级：仅失去刷新重连能力。
  }
}

export function useOnlineGame(
  modeId: 'dark-chess-4x8' | 'dark-chess-3p-4x8',
  connection: OnlineConnection,
): GameController {
  const mode = useMemo(
    () => (modeId === 'dark-chess-3p-4x8' ? createDarkChess3p4x8Mode() : createDarkChess4x8Mode()),
    [modeId],
  );
  const viewEngine = useMemo(() => createEngine(mode), [mode]);
  const [state, setState] = useState<GameState | null>(null);
  const stateRef = useRef<GameState | null>(null);
  const [selected, setSelected] = useState<Position | null>(null);
  const [notices, setNotices] = useState<readonly EliminationNotice[]>([]);
  const [online, setOnline] = useState<OnlineInfo>({
    status: 'connecting',
    playerId: '',
    roomId: connection.roomId,
    token: connection.token ?? '',
    roomPlayers: [],
    lastError: null,
  });
  const sessionRef = useRef<WebSocketGameSession | null>(null);
  const tokenRef = useRef<string | undefined>(connection.token ?? loadStoredToken(connection.url, connection.roomId));
  // 内部重连次数：reconnect() 递增以重建连接（复用最新令牌恢复原座位）。
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let disposed = false;
    let session: WebSocketGameSession | null = null;
    setState(null);
    stateRef.current = null;
    setNotices([]);
    setOnline({
      status: 'connecting',
      playerId: '',
      roomId: connection.roomId,
      token: tokenRef.current ?? '',
      roomPlayers: [],
      lastError: null,
    });

    void connectWebSocketGameSession({
      url: connection.url,
      roomId: connection.roomId,
      token: tokenRef.current,
      onState: (next) => {
        if (disposed) return;
        const prev = stateRef.current;
        if (prev !== null && prev !== next) {
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
      },
      onConnectionChange: (status: ConnectionStatus) => {
        if (disposed) return;
        setOnline((info) => ({ ...info, status }));
      },
      onRoomStatus: (status, players) => {
        if (disposed) return;
        setOnline((info) => ({
          ...info,
          status: status === 'waiting' ? 'waiting' : status === 'playing' ? 'playing' : info.status,
          roomPlayers: players,
        }));
      },
      onRejected: (rejection) => {
        if (disposed) return;
        setOnline((info) => ({ ...info, lastError: `${rejection.code}: ${rejection.reason}` }));
      },
      onEliminated: (event) => {
        if (disposed) return;
        // 原因由服务器声明（timeout / resign / noLegalAction）。
        setNotices((list) => [
          ...list.filter((n) => n.playerId !== event.playerId),
          { playerId: event.playerId, reason: event.reason },
        ]);
      },
    })
      .then((connected) => {
        if (disposed) {
          connected.close();
          return;
        }
        session = connected;
        sessionRef.current = connected;
        tokenRef.current = connected.token;
        saveStoredToken(connection.url, connection.roomId, connected.token);
        setOnline((info) => ({
          ...info,
          playerId: connected.playerId,
          roomId: connected.roomId,
          token: connected.token,
        }));
      })
      .catch((err: unknown) => {
        if (disposed) return;
        setOnline((info) => ({
          ...info,
          status: 'closed',
          lastError: err instanceof Error ? err.message : String(err),
        }));
      });

    return () => {
      disposed = true;
      session?.close();
      sessionRef.current = null;
    };
  }, [connection.url, connection.roomId, attempt]);

  const submitAction = useCallback((action: GameAction) => {
    const current = stateRef.current;
    const session = sessionRef.current;
    if (!current || !session || current.status.kind !== 'inProgress') return;
    // 服务器以连接绑定身份处理指令；信封 playerId 仅接口兼容。
    session.submit({ playerId: current.currentPlayerId, action });
    const wasCapture = action.kind === 'move' && pieceAt(current.board, action.to) !== null;
    soundManager.play(action.kind === 'reveal' ? 'reveal' : wasCapture ? 'capture' : 'move');
  }, []);

  const { revealTargets, movablePieces, moveByFrom } = useMemo(() => {
    const reveal = new Set<string>();
    const movable = new Set<string>();
    const moves = new Map<string, Position[]>();
    if (state && state.status.kind === 'inProgress') {
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
      const current = stateRef.current;
      if (!current || current.status.kind !== 'inProgress') return;
      // 联机热座语义：当前浏览器以“当前回合玩家”名义提交（三人需三人三浏览器；
      // 单浏览器联机时由当前回合玩家操作）。
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

  return {
    mode,
    state,
    phase: state ? phaseOf(state) : 'PLAYING',
    selected,
    revealTargets,
    selectedMoveTargets,
    movablePieces,
    eliminationNotices: notices,
    clickCell,
    newGame: () => undefined, // 联机模式没有“新对局”（房间生命周期由服务器管理）
    online,
    reconnect: useCallback(() => {
      setAttempt((a) => a + 1); // 复用最新令牌恢复原座位
    }, []),
    close: useCallback(() => {
      sessionRef.current?.close();
    }, []),
  };
}
