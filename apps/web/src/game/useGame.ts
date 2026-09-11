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
import { friendlyRejection } from '../ui/friendly';

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

/**
 * 联机会话状态。'idle' 表示尚未请求任何连接（App 层 hook 常驻、连接由房间页
 * 表单触发后才有 'connecting' 及后续状态）——区分空闲与连接中是防回归关键。
 */
export type OnlineStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'waiting' | 'playing';

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
  /** 短暂提示（人话文案；数秒后自动消失，不阻塞操作）。 */
  toast: string | null;
  /** 当前回合剩余秒数（联机计时房；null = 不限时/本地模式）。显示用，权威在服务器。 */
  turnRemainingSec: number | null;
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
  // epoch：新对局重建会话（旧会话不可变状态直接丢弃）。
  const [epoch, setEpoch] = useState(0);
  const session = useMemo(() => createLocalSession(mode), [mode, epoch]);
  const [state, setState] = useState<GameState>(() => session.getState());
  const stateRef = useRef(state);
  const [selected, setSelected] = useState<Position | null>(null);
  const [notices, setNotices] = useState<readonly EliminationNotice[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((text: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

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
    setNotices([]);
    setToast(null);
    setEpoch((e) => e + 1);
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
    toast,
    turnRemainingSec: null, // 本地不计时
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
  /** 联机模式：决定服务器房间使用哪个 GameMode（2P / 3P）。 */
  mode: '2p' | '3p';
  /** 计时秒数（仅对新建房间生效）；缺省 = 不限时。 */
  timerSec?: number;
  /** 初始重连令牌（缺省尝试 localStorage 中保存的令牌）。 */
  token?: string;
}

// 重连令牌是“恢复正在进行中的游戏”的凭证：key 必须含模式（2P/3P 互相隔离），
// 且在对局结束（收到 terminal 广播）时立即删除——terminal 后不得污染新游戏流程。
function storedTokenKey(url: string, mode: string, roomId: string): string {
  return `darkchess:ws:${url}:${mode}:${roomId}`;
}

function loadStoredToken(url: string, mode: string, roomId: string): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage.getItem(storedTokenKey(url, mode, roomId)) ?? undefined;
  } catch {
    return undefined;
  }
}

function saveStoredToken(url: string, mode: string, roomId: string, token: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storedTokenKey(url, mode, roomId), token);
  } catch {
    // 存储不可用时静默降级：仅失去刷新重连能力。
  }
}

function deleteStoredToken(url: string, mode: string, roomId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(storedTokenKey(url, mode, roomId));
  } catch {
    // 忽略
  }
}

/** 房间页查询：本机是否保存有该模式+房间的重连令牌（将恢复原座位）。 */
export function peekStoredToken(url: string, mode: string, roomId: string): boolean {
  return loadStoredToken(url, mode, roomId) !== undefined;
}

/** 无连接时的稳定空连接（保持 hook 引用稳定，避免 effect 反复触发）。 */
export const NULL_CONNECTION: OnlineConnection = { url: '', roomId: '', mode: '3p' };

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
    // App 层 hook 常驻：未请求连接时必须是 idle，否则房间页会把空闲误判为连接中。
    status: connection.url ? 'connecting' : 'idle',
    playerId: '',
    roomId: connection.roomId,
    token: connection.token ?? '',
    roomPlayers: [],
    lastError: null,
  });
  const sessionRef = useRef<WebSocketGameSession | null>(null);
  // online 的镜像 ref：submitAction 等回调读取最新值而不必进入依赖数组。
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const tokenRef = useRef<string | undefined>(
    connection.token ?? loadStoredToken(connection.url, connection.mode, connection.roomId),
  );
  // 内部重连次数：reconnect() 递增以重建连接（复用最新令牌恢复原座位）。
  const [attempt, setAttempt] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((text: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  // 回合倒计时（显示用）：以服务器广播的剩余秒数为基准，本地按 250ms 粒度递减，
  // 每次权威广播重新同步（服务器仍是超时判定的唯一权威）。
  const [remainingSec, setRemainingSec] = useState<number | null>(null);
  const deadlineRef = useRef<number | null>(null);
  const [displaySec, setDisplaySec] = useState<number | null>(null);
  useEffect(() => {
    if (remainingSec === null) {
      deadlineRef.current = null;
      setDisplaySec(null);
      return;
    }
    deadlineRef.current = Date.now() + remainingSec * 1000;
    const tick = () =>
      setDisplaySec(Math.max(0, Math.ceil((deadlineRef.current! - Date.now()) / 1000)));
    tick();
    const iv = setInterval(tick, 250);
    return () => clearInterval(iv);
  }, [remainingSec]);

  useEffect(() => {
    if (!connection.url) {
      // 空连接（NULL_CONNECTION）：回到空闲态。仅在非 idle 时更新（返回同一引用，
      // 避免每次 effect 触发新的重渲染循环）。
      setOnline((info) =>
        info.status === 'idle'
          ? info
          : {
              status: 'idle',
              playerId: '',
              roomId: connection.roomId,
              token: '',
              roomPlayers: [],
              lastError: null,
            },
      );
      return;
    }
    let disposed = false;
    let session: WebSocketGameSession | null = null;
    setState(null);
    stateRef.current = null;
    setNotices([]);
    setRemainingSec(null);
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
      mode: connection.mode,
      timerSec: connection.timerSec,
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
        if (next.status.kind !== 'inProgress') {
          // 对局已终局：重连凭证使命完成，立即清除，避免污染之后的新游戏流程。
          deleteStoredToken(connection.url, connection.mode, connection.roomId);
          tokenRef.current = undefined;
        }
      },
      onTurnRemainingSec: (sec) => {
        if (disposed) return;
        setRemainingSec(sec); // null = 不限时
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
        // 正式 UI 说人话；原始 code 留在 console（后续可入调试面板）。
        console.debug(`[darkchess] rejected: ${rejection.code} ${rejection.reason}`);
        setOnline((info) => ({ ...info, lastError: `${rejection.code}: ${rejection.reason}` }));
        showToast(friendlyRejection(rejection.code, rejection.reason));
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
        saveStoredToken(connection.url, connection.mode, connection.roomId, connected.token);
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

  // 座位门控：联机时本浏览器只操作自己的座位（多设备各管一座，行为与服务器
  // 权威校验一致）；本地热座无门控。未绑定身份（等待期）同样不亮子。
  const ownTurn =
    online.playerId !== '' &&
    state !== null &&
    state.status.kind === 'inProgress' &&
    state.currentPlayerId === online.playerId;

  const submitAction = useCallback((action: GameAction) => {
    const current = stateRef.current;
    const session = sessionRef.current;
    if (!current || !session || current.status.kind !== 'inProgress') return;
    if (onlineRef.current.playerId === '' || current.currentPlayerId !== onlineRef.current.playerId) {
      showToast('还没轮到你行动');
      return;
    }
    // 服务器以连接绑定身份处理指令；信封 playerId 仅接口兼容。
    session.submit({ playerId: current.currentPlayerId, action });
    const wasCapture = action.kind === 'move' && pieceAt(current.board, action.to) !== null;
    soundManager.play(action.kind === 'reveal' ? 'reveal' : wasCapture ? 'capture' : 'move');
  }, [showToast]);

  const { revealTargets, movablePieces, moveByFrom } = useMemo(() => {
    const reveal = new Set<string>();
    const movable = new Set<string>();
    const moves = new Map<string, Position[]>();
    if (state && state.status.kind === 'inProgress' && ownTurn) {
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
  }, [viewEngine, state, ownTurn]);

  const selectedMoveTargets = useMemo(() => {
    if (!selected) return new Set<string>();
    const list = moveByFrom.get(`${selected.x},${selected.y}`) ?? [];
    return new Set(list.map((p) => `${p.x},${p.y}`));
  }, [selected, moveByFrom]);

  const clickCell = useCallback(
    (x: number, y: number) => {
      const current = stateRef.current;
      if (!current || current.status.kind !== 'inProgress') return;
      if (onlineRef.current.playerId !== '') {
        const me = current.players.find((pl) => pl.id === onlineRef.current.playerId);
        if (me?.eliminated === true) {
          showToast('你已经被淘汰，无法继续行动');
          return;
        }
      }
      if (!ownTurn) {
        showToast('还没轮到你行动');
        return;
      }
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
    [ownTurn, selected, selectedMoveTargets, revealTargets, movablePieces, submitAction, showToast],
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
    toast,
    turnRemainingSec: displaySec,
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
