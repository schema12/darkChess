import type {
  CommandEnvelope,
  GameState,
  PlayerId,
  Unsubscribe,
} from '@darkchess/core';
import type {
  ClientMessage,
  EliminationReason,
  RoomPlayerInfo,
  RoomStatus,
  ServerMessage,
} from '../protocol';

/**
 * 最小 WebSocket 结构接口：浏览器与 Node(≥22) 的全局 WebSocket 均满足，
 * 因此本文件不含任何 Node / DOM 专属依赖，可被 web 与 server 两端安全引用。
 */
export interface WsLike {
  send(data: string): void;
  close(): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

export interface WebSocketSessionEvents {
  /** 连接状态变化（connecting -> open -> closed）。 */
  onConnectionChange?(status: ConnectionStatus): void;
  /** 每次权威状态广播（含连接期触发的开局广播——不会错过任何一份）。 */
  onState?(state: GameState): void;
  /** 每次权威状态广播携带的回合剩余秒数（null = 不限时）。 */
  onTurnRemainingSec?(sec: number | null): void;
  /** 服务器拒绝（notCurrentPlayer / illegalAction / playerEliminated / roomClosed 等）。 */
  onRejected?(rejection: { code: string; reason: string }): void;
  /** 服务器权威淘汰（原因由服务器声明：timeout / noLegalAction / resign）。 */
  onEliminated?(event: { playerId: PlayerId; reason: EliminationReason }): void;
  /** 房间公开状态（座位连接情况 / 阵营 / 淘汰——均为公共信息）。 */
  onRoomStatus?(status: RoomStatus, players: readonly RoomPlayerInfo[]): void;
}

export interface WebSocketSessionOptions extends WebSocketSessionEvents {
  /** 服务器地址，如 ws://localhost:8787。 */
  url: string;
  /** 房间 id；缺省加入服务器默认房间。 */
  roomId?: string;
  /** 重连令牌（此前 welcome 返回的 token）；提供时恢复原座位。 */
  token?: string;
  /** 模式选择（服务器 URL ?mode= 参数，如 '2p' | '3p'）；缺省为服务器默认模式。 */
  mode?: string;
  /** 计时秒数（URL ?timer= 参数；仅对新建房间生效）。缺省 = 不限时。 */
  timerSec?: number;
  /** 连接超时毫秒，缺省 5000。 */
  connectTimeoutMs?: number;
  /** WebSocket 工厂（测试可注入）；缺省使用环境全局 WebSocket。 */
  webSocketFactory?: (url: string) => WsLike;
}

/**
 * WebSocket 版对局会话：权威状态由服务器广播，客户端只提交指令。
 *
 * 与本地 GameSession（同步权威）的语义差异——这是异步权威的固有形状，
 * 不是接口缺失：
 * - `submit` 只负责把指令发送到服务器（返回 void）；结果（新状态 / rejected）
 *   分别经 subscribe 与 onRejected 异步到达；
 * - 客户端不能判定 winner / timeout / eliminated，这些全部来自服务器广播；
 * - `forfeit` 不提供给客户端：超时由服务器计时器触发，认输走 resign 协议消息。
 */
export interface WebSocketGameSession {
  /** 当前权威状态快照；房间尚未开局（等待玩家加入）时为 null。 */
  getState(): GameState | null;
  /** 订阅权威状态广播（开局与每次权威结算后各广播一次）。 */
  subscribe(listener: (state: GameState) => void): Unsubscribe;
  /**
   * 提交指令。envelope.playerId 仅为接口兼容——服务器以连接绑定的座位身份
   * 处理指令，客户端在此字段声明任何身份都不生效。
   */
  submit(command: CommandEnvelope): void;
  close(): void;
  /** 服务端分配的座位身份（重连后保持不变）。 */
  readonly playerId: PlayerId;
  /** 重连令牌（页面刷新前保存可实现重连）。 */
  readonly token: string;
  readonly roomId: string;
}

export interface ConnectedWebSocketSession {
  session: WebSocketGameSession;
  /** welcome 时的房间状态（waiting / playing）。 */
  initialStatus: RoomStatus;
}

function buildUrl(
  url: string,
  roomId: string | undefined,
  token: string | undefined,
  mode: string | undefined,
  timerSec: number | undefined,
): string {
  const base = url.replace(/\/+$/, '');
  const params = new URLSearchParams();
  if (roomId !== undefined) params.set('room', roomId);
  if (token !== undefined) params.set('token', token);
  if (mode !== undefined) params.set('mode', mode);
  if (timerSec !== undefined) params.set('timer', String(timerSec));
  const query = params.toString();
  return query.length > 0 ? `${base}/?${query}` : `${base}/`;
}

function defaultWebSocketFactory(url: string): WsLike {
  const ctor = (globalThis as unknown as { WebSocket?: new (url: string) => unknown }).WebSocket;
  if (typeof ctor !== 'function') {
    throw new Error('当前环境没有可用的 WebSocket 实现');
  }
  return new ctor(url) as unknown as WsLike;
}

/**
 * 连接服务器并加入/重连房间；在收到首份权威状态后解析出会话。
 * 连接期收到 rejected（如房间已满、令牌无效）或断开 → Promise 以明确错误拒绝。
 */
export function connectWebSocketGameSession(
  options: WebSocketSessionOptions,
): Promise<WebSocketGameSession> {
  const {
    url,
    roomId,
    token,
    mode,
    timerSec,
    connectTimeoutMs = 5000,
    webSocketFactory,
    onConnectionChange,
    onState,
    onTurnRemainingSec,
    onRejected,
    onEliminated,
    onRoomStatus,
  } = options;

  return new Promise<WebSocketGameSession>((resolve, reject) => {
    let settled = false;
    let closed = false;
    let playerId: PlayerId | null = null;
    let sessionToken = token ?? '';
    let sessionRoomId = roomId ?? 'room-1';
    let latest: GameState | null = null;
    const listeners = new Set<(state: GameState) => void>();

    let ws: WsLike;
    try {
      ws = (webSocketFactory ?? defaultWebSocketFactory)(buildUrl(url, roomId, token, mode, timerSec));
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    const settleFailure = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      try {
        ws.close();
      } catch {
        // 忽略关闭异常
      }
      reject(error);
    };

    const connectTimer = setTimeout(() => {
      settleFailure(new Error('连接超时'));
    }, connectTimeoutMs);

    const settleSuccess = () => {
      if (settled || playerId === null) return;
      settled = true;
      clearTimeout(connectTimer);
      const session: WebSocketGameSession = {
        playerId,
        token: sessionToken,
        roomId: sessionRoomId,
        getState() {
          return latest;
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        submit(command: CommandEnvelope): void {
          // 身份安全：playerId 以连接绑定的座位为准，客户端声明不生效；
          // 服务器校验 notCurrentPlayer / eliminated / legality 并广播结果。
          if (closed) return;
          ws.send(JSON.stringify({ type: 'command', action: command.action } satisfies ClientMessage));
        },
        close() {
          closed = true;
          try {
            ws.close();
          } catch {
            // 忽略关闭异常
          }
        },
      };
      resolve(session);
    };

    ws.onopen = () => {
      onConnectionChange?.('open');
    };
    ws.onmessage = (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return; // 非法消息直接丢弃，不影响连接
      }
      switch (message.type) {
        case 'welcome':
          playerId = message.playerId;
          sessionToken = message.token;
          sessionRoomId = message.roomId;
          settleSuccess();
          break;
        case 'state':
          latest = message.state;
          // 连接级事件先于订阅者通知：任何状态广播（含连接期开局广播）都不遗漏。
          onState?.(message.state);
          onTurnRemainingSec?.(message.turnRemainingSec ?? null);
          for (const listener of [...listeners]) listener(message.state);
          break;
        case 'rejected':
          if (!settled) {
            settleFailure(new Error(`${message.code}: ${message.reason}`));
          } else {
            onRejected?.({ code: message.code, reason: message.reason });
          }
          break;
        case 'eliminated':
          onEliminated?.({ playerId: message.playerId, reason: message.reason });
          break;
        case 'roomStatus':
          onRoomStatus?.(message.status, message.players);
          break;
      }
    };
    ws.onclose = () => {
      onConnectionChange?.('closed');
      if (!settled) {
        settleFailure(new Error('连接已断开'));
      }
    };
    ws.onerror = () => {
      // 错误细节不经协议传递；close 事件随后到达并完成失败结算。
    };
  });
}
