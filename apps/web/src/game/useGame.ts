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
import type { RoomConfigInfo, RoomPlayerInfo } from '@darkchess/server/protocol';
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
  /** 房间配置（房主创建时决定，服务器权威；加入者只读）。 */
  config: RoomConfigInfo | null;
  /** 已点击“再来一局”的玩家（terminal 后准备阶段）。 */
  rematchReady: readonly string[];
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
  /** 本回合计时策略时长（秒）；非当前行动玩家卡片静态显示用。 */
  turnPolicySec: number | null;
  /** 本机已消耗的求和次数（联机；服务器权威）。 */
  myDrawCount: number;
  /** 待本人回应的求和提议发起者（联机；null = 无）。 */
  pendingDrawFrom: string | null;
  /** 已点击“再来一局”的玩家（联机 terminal 后）。 */
  rematchReady: readonly string[];
  /** 认输（联机；确认弹窗由 UI 负责）。 */
  resign: (() => void) | null;
  /** 发起求和（联机）。 */
  drawOffer: (() => void) | null;
  /** 回应求和（联机）。 */
  drawResponse: ((accept: boolean) => void) | null;
  /** 再来一局：标记本机已准备（联机 terminal 后）。 */
  rematchReadyAction: (() => void) | null;
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
    turnPolicySec: null,
    myDrawCount: 0,
    pendingDrawFrom: null,
    rematchReady: [],
    resign: null,
    drawOffer: null,
    drawResponse: null,
    rematchReadyAction: null,
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
    config: null,
    rematchReady: [],
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
  // 令牌连接失败的“无令牌回退”只允许一次（防无限重试）。
  const retryRef = useRef(false);
  // 求和：本机已消耗次数 / 待本人回应的提议（服务器权威，客户端仅展示与发送）。
  const [myDrawCount, setMyDrawCount] = useState(0);
  const [pendingDrawFrom, setPendingDrawFrom] = useState<string | null>(null);
  const onDrawOfferRef = useRef<(e: { fromPlayerId: string; count: number; max: number }) => void>(() => undefined);
  const onDrawResponseRef = useRef<(e: { fromPlayerId: string; accept: boolean }) => void>(() => undefined);
  const onSendFailRef = useRef<(label: string) => void>(() => undefined);
  // LAN 延迟诊断（仅 DEV 构建）：submit → 收到权威 state 的往返时延 + turn 对齐。
  const dev = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV ?? false;
  const diagRef = useRef<{ submitAt: number; turn: number } | null>(null);
  const pendingDrawRef = useRef<string | null>(pendingDrawFrom);
  pendingDrawRef.current = pendingDrawFrom;
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

  // 求和处理器的注册点（connect 的 options 经 ref 调用以规避 disposed 闭包问题）。
  onDrawOfferRef.current = (event) => {
    if (event.fromPlayerId === onlineRef.current.playerId) {
      setMyDrawCount(event.count); // 自己的提议回执：更新已消耗次数
    } else {
      setPendingDrawFrom(event.fromPlayerId); // 弹出求和询问（不阻塞计时）
    }
  };
  onDrawResponseRef.current = (event) => {
    if (pendingDrawRef.current === event.fromPlayerId) {
      setPendingDrawFrom(null);
      showToast(`玩家${event.fromPlayerId}${event.accept ? '同意和棋' : '拒绝和棋'}`);
    }
  };
  onSendFailRef.current = (label) => {
    // 静默吞掉指令是“点击无反应”的来源之一：socket 未就绪时必须可见。
    showToast('连接未就绪，请稍后重试');
    console.debug(`[diag] send failed: ${label} (socket not open)`);
  };

  // 回合倒计时（显示用）：服务器为唯一权威，每条广播携带 (turnNumber, 剩余秒)。
  // 重置条件 = 回合变化或秒数变化——相邻两回合同值（30→30）也必须重置（Bug1 根因）。
  const [turnTimer, setTurnTimer] = useState<{
    turn: number;
    policySec: number;
    deadline: number;
  } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(iv);
  }, []);
  const turnRemainingSec =
    turnTimer === null ? null : Math.max(0, Math.ceil((turnTimer.deadline - now) / 1000));
  // 最后 10 秒逐秒提示音（每秒值最多触发一次；仅当前行动者的倒计时，权威判定仍在服务器）。
  const lastBeepRef = useRef<number | null>(null);
  useEffect(() => {
    if (turnRemainingSec !== null && turnRemainingSec >= 1 && turnRemainingSec <= 10) {
      if (lastBeepRef.current !== turnRemainingSec) {
        lastBeepRef.current = turnRemainingSec;
        soundManager.play('tick');
      }
    }
  }, [turnRemainingSec]);

  useEffect(() => {
    if (!connection.url) {
      // 空连接（NULL_CONNECTION）：回到空闲态并清除上一局残留视图状态
      //（否则换模式/换房间时带着 stale state 自动进入旧对局——Bug3/4 根因）。
      setState(null);
      stateRef.current = null;
      setNotices([]);
      setTurnTimer(null);
      setOnline((info) =>
        info.status === 'idle'
          ? info
          : {
              status: 'idle',
              playerId: '',
              roomId: connection.roomId,
              token: '',
              roomPlayers: [],
              config: null,
              rematchReady: [],
              lastError: null,
            },
      );
      return;
    }
    let disposed = false;
    let session: WebSocketGameSession | null = null;
    // 每条连接的令牌按 (url, mode, roomId) 重新解析——上一连接/上一模式的 token 不得复用。
    tokenRef.current =
      connection.token ?? loadStoredToken(connection.url, connection.mode, connection.roomId);
    setState(null);
    stateRef.current = null;
    setNotices([]);
    setTurnTimer(null);
    setOnline({
      status: 'connecting',
      playerId: '',
      roomId: connection.roomId,
      token: tokenRef.current ?? '',
      roomPlayers: [],
      config: null,
      rematchReady: [],
      lastError: null,
    });

    void connectWebSocketGameSession({
      url: connection.url,
      roomId: connection.roomId,
      mode: connection.mode,
      timerSec: connection.timerSec,
      token: tokenRef.current,
      onDrawOffer: (event) => onDrawOfferRef.current(event),
      onDrawResponse: (event) => onDrawResponseRef.current(event),
      onSendFail: (label) => onSendFailRef.current(label),
      onState: (next, remaining) => {
        if (disposed) return;
        // 联机模式淘汰原因唯一来源 = 服务器 eliminated 消息（携带权威 reason，先于 state 到达）。
        // 此处严禁从 state 差分合成 noLegalAction——否则 timeout 玩家会多出一条原因重复的通知（P0）。
        if (dev && diagRef.current !== null && next.turnNumber > diagRef.current.turn) {
          console.debug(
            `[diag] state turn=${next.turnNumber} rtt=${Date.now() - diagRef.current.submitAt}ms remaining=${String(remaining)}`,
          );
          diagRef.current = null;
        }
        stateRef.current = next;
        setState(next);
        if (next.turnNumber === 0) {
          // 新对局（含再来一局）：重置本机求和计数、待回应提议与上一局 transient 横幅。
          setMyDrawCount(0);
          setPendingDrawFrom(null);
          setNotices([]);
        }
        if (next.status.kind !== 'inProgress') {
          // 对局已终局：重连凭证使命完成，立即清除，避免污染之后的新游戏流程。
          deleteStoredToken(connection.url, connection.mode, connection.roomId);
          tokenRef.current = undefined;
          setTurnTimer(null);
        } else if (remaining !== null) {
          // 按回合重置倒计时：回合变化或秒数变化都触发（同值跨回合同样重置——Bug1）。
          setTurnTimer((prevTimer) => {
            if (
              prevTimer !== null &&
              prevTimer.turn === next.turnNumber &&
              prevTimer.policySec === remaining
            ) {
              return prevTimer; // 同一回合内的重复广播：保持现基准
            }
            return {
              turn: next.turnNumber,
              policySec: remaining,
              deadline: Date.now() + remaining * 1000,
            };
          });
        } else {
          setTurnTimer(null); // 不限时
        }
      },
      onConnectionChange: (status: ConnectionStatus) => {
        if (disposed) return;
        setOnline((info) => ({ ...info, status }));
      },
      onRoomStatus: (status, players, config, rematchReady) => {
        if (disposed) return;
        setOnline((info) => ({
          ...info,
          status: status === 'waiting' ? 'waiting' : status === 'playing' ? 'playing' : info.status,
          roomPlayers: players,
          config: config ?? info.config,
          rematchReady: rematchReady ?? info.rematchReady,
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
        const message = err instanceof Error ? err.message : String(err);
        // 带令牌的连接失败（旧 token 已随终局/替换失效）→ 清除令牌并回退一次全新加入，
        // 实现“旧房间重开”的无缝体验；回退仅一次，避免无限重试。
        if (
          tokenRef.current !== undefined &&
          /invalidToken|roomClosed/.test(message) &&
          !retryRef.current
        ) {
          retryRef.current = true;
          deleteStoredToken(connection.url, connection.mode, connection.roomId);
          tokenRef.current = undefined;
          setAttempt((a) => a + 1);
          return;
        }
        setOnline((info) => ({
          ...info,
          status: 'closed',
          lastError: message,
        }));
      });

    return () => {
      disposed = true;
      session?.close();
      sessionRef.current = null;
    };
  }, [connection.url, connection.roomId, connection.mode, attempt]);

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
    if (dev) {
      diagRef.current = { submitAt: Date.now(), turn: current.turnNumber };
      console.debug(`[diag] submit turn=${current.turnNumber} player=${current.currentPlayerId} t=${Date.now()}`);
    }
    const wasCapture = action.kind === 'move' && pieceAt(current.board, action.to) !== null;
    soundManager.play(action.kind === 'reveal' ? 'reveal' : wasCapture ? 'capture' : 'move');
  }, [showToast, dev]);

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
    turnRemainingSec:
      turnTimer !== null ? Math.max(0, Math.ceil((turnTimer.deadline - now) / 1000)) : null,
    turnPolicySec: turnTimer?.policySec ?? null,
    myDrawCount,
    pendingDrawFrom,
    rematchReady: online.rematchReady,
    resign: useCallback(() => {
      if (dev) console.debug('[diag] resign click');
      if (sessionRef.current?.resign() === false) showToast('连接未就绪，请稍后重试');
    }, [showToast, dev]),
    drawOffer: useCallback(() => {
      if (dev) console.debug('[diag] drawOffer click');
      if (sessionRef.current?.drawOffer() === false) showToast('连接未就绪，请稍后重试');
    }, [showToast, dev]),
    drawResponse: useCallback((accept: boolean) => {
      if (sessionRef.current?.drawResponse(accept) === false) showToast('连接未就绪，请稍后重试');
    }, []),
    rematchReadyAction: useCallback(() => {
      if (dev) console.debug('[diag] rematch click');
      if (sessionRef.current?.rematchReady() === false) showToast('连接未就绪，请稍后重试');
    }, [dev]),
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
