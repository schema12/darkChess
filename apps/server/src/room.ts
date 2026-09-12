import { randomUUID } from 'node:crypto';
import { createEngine, validateCommand } from '@darkchess/core';
import type {
  GameAction,
  GameEngine,
  GameMode,
  GameState,
  PlayerId,
} from '@darkchess/core';
import type {
  ClientMessage,
  EliminationReason,
  RoomPlayerInfo,
  RoomStatus,
  ServerMessage,
} from './protocol';

/**
 * 传输无关的权威对局房间。
 *
 * 职责：座位分配（服务端发放 playerId 与重连令牌）、指令校验与执行（复用
 * core 的 validateCommand / engine.apply）、状态广播、断线保留座位、
 * 服务端回合计时（可选）。客户端永远只能提交指令——胜负、淘汰、阵营、
 * 当前回合全部由本房间内的权威引擎状态决定。
 */
export interface RoomConnection {
  send(message: ServerMessage): void;
  close(): void;
}

interface Seat {
  readonly playerId: PlayerId;
  readonly token: string;
  connected: boolean;
  connection: RoomConnection | null;
}

export interface GameRoomConfig {
  readonly roomId: string;
  readonly mode: GameMode;
  /** 座位 id（须与玩法 createInitialState 的玩家 id 一致，如 3P 为 A/B/C）。 */
  readonly seatIds: readonly PlayerId[];
  readonly seed?: number;
  /** 回合计时毫秒；缺省不启用超时（阶段 5 使用）。 */
  readonly turnTimeoutMs?: number;
}

export interface JoinResult {
  readonly ok: boolean;
  readonly reason?: string;
  /** 失败原因码（roomFull / roomClosed），由调用方（桥接）决定是否发送给客户端。 */
  readonly code?: string;
  readonly playerId?: PlayerId;
  readonly token?: string;
}

export interface GameRoom {
  readonly roomId: string;
  /** 入座并绑定身份；满员/已开局时拒绝（通过连接发送 rejected 消息）。 */
  join(connection: RoomConnection): JoinResult;
  /** 凭重连令牌恢复座位：不新建玩家、不重置棋局、不改变阵营。 */
  rejoin(token: string, connection: RoomConnection): JoinResult;
  /** 连接断开：保留座位与身份，等待重连；计时继续（超时仍会判负）。 */
  disconnect(connection: RoomConnection): void;
  /** 处理已绑定身份连接提交的消息；客户端声明的身份信息一律无效。 */
  handleClientMessage(playerId: PlayerId, message: ClientMessage): void;
  /** 立即对指定玩家执行权威判负（服务器计时器/管理操作使用）。 */
  forfeit(playerId: PlayerId, reason: EliminationReason): boolean;
  close(): void;
  getState(): GameState | null;
  getStatus(): RoomStatus;
  /** 回合计时策略（毫秒；undefined = 不限时）。属于房间生命周期，替换/重开时继承。 */
  timerPolicyMs(): number | undefined;
  playersInfo(): readonly RoomPlayerInfo[];
}

export function createGameRoom(config: GameRoomConfig): GameRoom {
  const engine: GameEngine = createEngine(config.mode);
  const seats = new Map<PlayerId, Seat>();
  let status: RoomStatus = 'waiting';
  let state: GameState | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timerGeneration = 0;
  /** 当前回合截止时刻（ms 时间戳）；null = 不限时/非对局阶段。 */
  let turnDeadline: number | null = null;

  function seatInfo(seat: Seat): RoomPlayerInfo {
    const player = state?.players.find((pl) => pl.id === seat.playerId);
    return {
      playerId: seat.playerId,
      connected: seat.connected,
      factionId: player?.factionId ?? null,
      eliminated: player?.eliminated === true,
    };
  }

  function sendTo(seat: Seat, message: ServerMessage): void {
    if (seat.connected) seat.connection?.send(message);
  }

  function broadcast(message: ServerMessage): void {
    for (const seat of seats.values()) sendTo(seat, message);
  }

  function broadcastRoomStatus(): void {
    broadcast({ type: 'roomStatus', status, players: [...seats.values()].map(seatInfo) });
  }

  function disarmTimer(): void {
    timerGeneration += 1;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    turnDeadline = null;
  }

  /** 当前回合剩余秒数（向上取整）；不限时返回 null。广播时间点取样，权威判定仍在服务端。 */
  function remainingSec(): number | null {
    if (turnDeadline === null) return null;
    return Math.max(0, Math.ceil((turnDeadline - Date.now()) / 1000));
  }

  /** state 广播统一携带计时信息（null = 不限时）。 */
  function stateMessage(st: GameState): ServerMessage {
    return { type: 'state', state: st, turnRemainingSec: remainingSec() };
  }

  function armTimer(): void {
    disarmTimer();
    if (config.turnTimeoutMs === undefined || status !== 'playing') return;
    if (!state || state.status.kind !== 'inProgress') return;
    turnDeadline = Date.now() + config.turnTimeoutMs;
    const generation = timerGeneration;
    timer = setTimeout(() => {
      if (generation !== timerGeneration) return;
      const current = state?.currentPlayerId;
      if (current !== undefined) forfeit(current, 'timeout');
    }, config.turnTimeoutMs);
    timer.unref(); // 不阻止进程退出
  }

  function finish(): void {
    status = 'finished';
    disarmTimer();
    if (state) broadcast(stateMessage(state));
    broadcastRoomStatus();
  }

  /** 广播结算后新出现的淘汰（原因由触发方声明：超时/认输/无合法行动）。 */
  function announceEliminations(previous: GameState, reason: EliminationReason): void {
    if (!state) return;
    for (const player of state.players) {
      const before = previous.players.find((q) => q.id === player.id);
      if (player.eliminated === true && before?.eliminated !== true) {
        broadcast({ type: 'eliminated', playerId: player.id, reason });
      }
    }
  }

  function forfeit(playerId: PlayerId, reason: EliminationReason): boolean {
    if (status !== 'playing' || !state || state.status.kind !== 'inProgress') return false;
    const previous = state;
    let next: GameState;
    try {
      next = engine.forfeit(state, playerId);
    } catch {
      return false; // 已淘汰/未知玩家等：权威引擎拒绝，房间状态不变
    }
    state = next;
    announceEliminations(previous, reason);
    if (state.status.kind === 'inProgress') {
      armTimer(); // 先重置计时，广播携带新回合的剩余时间
      broadcast(stateMessage(state));
    } else {
      finish();
    }
    return true;
  }

  function start(): void {
    if (status !== 'waiting') return;
    state = config.mode.createInitialState(config.seed);
    status = 'playing';
    armTimer(); // 先重置计时，开局广播携带剩余时间
    broadcast(stateMessage(state));
    broadcastRoomStatus();
  }

  function join(connection: RoomConnection): JoinResult {
    if (status !== 'waiting') {
      // 不直接发送 rejected：桥接可能对 finished 房间做“新对局替换”后重新 join，
      // 由桥接在最终失败时统一发送，避免客户端过早失败。
      return { ok: false, reason: '房间已开始或已结束，无法加入', code: 'roomClosed' };
    }
    const seatId = config.seatIds.find((id) => !seats.has(id));
    if (seatId === undefined) {
      return { ok: false, reason: '房间已满', code: 'roomFull' };
    }
    const seat: Seat = {
      playerId: seatId,
      token: randomUUID(),
      connected: true,
      connection,
    };
    seats.set(seatId, seat);
    connection.send({
      type: 'welcome',
      roomId: config.roomId,
      playerId: seatId,
      token: seat.token,
      status,
    });
    broadcastRoomStatus();
    if (seats.size === config.seatIds.length) start();
    return { ok: true, playerId: seatId, token: seat.token };
  }

  function rejoin(token: string, connection: RoomConnection): JoinResult {
    const seat = [...seats.values()].find((s) => s.token === token);
    if (!seat) {
      const reason = '无效的重连令牌';
      connection.send({ type: 'rejected', code: 'invalidToken', reason });
      return { ok: false, reason, code: 'invalidToken' };
    }
    if (status === 'finished') {
      // terminal 房间：旧 token 不得复活已结束的对局（结果此前已广播送达）。
      const reason = '对局已结束，无法恢复';
      connection.send({ type: 'rejected', code: 'roomClosed', reason });
      return { ok: false, reason, code: 'roomClosed' };
    }
    // 恢复原座位：playerId / 阵营 / 棋局 / 淘汰状态全部保持，仅恢复连接。
    seat.connection = connection;
    seat.connected = true;
    connection.send({
      type: 'welcome',
      roomId: config.roomId,
      playerId: seat.playerId,
      token,
      status,
    });
    if (state) connection.send(stateMessage(state));
    broadcastRoomStatus();
    return { ok: true, playerId: seat.playerId, token };
  }

  function disconnect(connection: RoomConnection): void {
    const seat = [...seats.values()].find((s) => s.connection === connection);
    if (!seat) return;
    seat.connected = false;
    seat.connection = null;
    broadcastRoomStatus();
  }

  function submitCommand(playerId: PlayerId, action: GameAction): void {
    const seat = seats.get(playerId);
    if (!seat || status !== 'playing' || !state || state.status.kind !== 'inProgress') {
      seat?.connection?.send({ type: 'rejected', code: 'gameOver', reason: '对局未在进行中' });
      return;
    }
    // 身份安全：playerId 来自连接绑定，客户端伪造字段不进入本函数。
    const check = validateCommand(engine, state, { playerId, action });
    if (!check.legal) {
      seat.connection?.send({ type: 'rejected', code: check.code, reason: check.reason });
      return;
    }
    const previous = state;
    state = engine.apply(state, action);
    announceEliminations(previous, 'noLegalAction');
    if (state.status.kind === 'inProgress') {
      armTimer(); // 先重置计时，广播携带新回合的剩余时间
      broadcast(stateMessage(state));
    } else {
      finish();
    }
  }

  function handleClientMessage(playerId: PlayerId, message: ClientMessage): void {
    switch (message.type) {
      case 'command':
        submitCommand(playerId, message.action);
        break;
      case 'resign':
        forfeit(playerId, 'resign');
        break;
    }
  }

  return {
    roomId: config.roomId,
    join,
    rejoin,
    disconnect,
    handleClientMessage,
    forfeit,
    close: disarmTimer,
    getState: () => state,
    getStatus: () => status,
    timerPolicyMs: () => config.turnTimeoutMs,
    playersInfo: () => [...seats.values()].map(seatInfo),
  };
}
