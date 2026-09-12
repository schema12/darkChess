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
  RoomConfigInfo,
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
  /** 等待阶段零在线时回调（桥接据此销毁空闲等待房，防止“自己和自己联机”）。 */
  readonly onEmpty?: (roomId: string) => void;
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
  /** 已点击“再来一局”的玩家（terminal 后准备阶段）。 */
  rematchReadyPlayers(): readonly PlayerId[];
  /** 房间配置（模式/计时），随 welcome/roomStatus 广播给客户端。 */
  configInfo(): RoomConfigInfo;
  /** 在线座位数（空闲/TTL 判定用）。 */
  onlineCount(): number;
  playersInfo(): readonly RoomPlayerInfo[];
}

export function createGameRoom(config: GameRoomConfig): GameRoom {
  const engine: GameEngine = createEngine(config.mode);
  const seats = new Map<PlayerId, Seat>();
  // LAN 延迟诊断（DARKCHESS_DEBUG=1 时启用）：receive → apply → broadcast 时间戳。
  const debug = process.env.DARKCHESS_DEBUG === '1';
  let status: RoomStatus = 'waiting';
  let state: GameState | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timerGeneration = 0;
  /** 当前回合截止时刻（ms 时间戳）；null = 不限时/非对局阶段。 */
  let turnDeadline: number | null = null;
  /** 全员离线的空闲暂停：计时冻结，重连后以剩余值继续。 */
  let idlePaused = false;
  let pausedRemainingMs: number | null = null;
  /** 求和：每名玩家每局最多主动发起 MAX_DRAW_OFFERS 次（被拒同样消耗）。 */
  const MAX_DRAW_OFFERS = 3;
  const drawOfferCounts = new Map<PlayerId, number>();
  /** 待回应的求和：发起者 + 尚未回应的存活玩家。 */
  let pendingDraw: { from: PlayerId; awaiting: PlayerId[] } | null = null;
  /** 再来一局：terminal 后已点击“再来一局”的玩家（全员准备 → 新对局）。 */
  const rematchReady = new Set<PlayerId>();

  function seatInfo(seat: Seat): RoomPlayerInfo {
    const player = state?.players.find((pl) => pl.id === seat.playerId);
    return {
      playerId: seat.playerId,
      connected: seat.connected,
      factionId: player?.factionId ?? null,
      eliminated: player?.eliminated === true,
      isHost: seat.playerId === config.seatIds[0],
    };
  }

  /** 房间配置（房主创建时决定，加入者只读）。 */
  function configInfo(): RoomConfigInfo {
    return {
      modeId: config.mode.id,
      timerSec: config.turnTimeoutMs !== undefined ? Math.round(config.turnTimeoutMs / 1000) : null,
    };
  }

  /** 在线（已连接）座位数。 */
  function onlineCount(): number {
    return [...seats.values()].filter((s) => s.connected).length;
  }

  function sendTo(seat: Seat, message: ServerMessage): void {
    if (seat.connected) seat.connection?.send(message);
  }

  function broadcast(message: ServerMessage): void {
    for (const seat of seats.values()) sendTo(seat, message);
  }

  function broadcastRoomStatus(): void {
    broadcast({
      type: 'roomStatus',
      status,
      players: [...seats.values()].map(seatInfo),
      config: configInfo(),
      rematchReady: [...rematchReady],
    });
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
    if (idlePaused) return pausedRemainingMs !== null ? Math.ceil(pausedRemainingMs / 1000) : null;
    if (turnDeadline === null) return null;
    return Math.max(0, Math.ceil((turnDeadline - Date.now()) / 1000));
  }

  /** state 广播统一携带计时信息（null = 不限时）。 */
  function stateMessage(st: GameState): ServerMessage {
    return { type: 'state', state: st, turnRemainingSec: remainingSec() };
  }

  function armTimer(): void {
    disarmTimer();
    if (idlePaused) return; // 空闲暂停期间不启动计时
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

  /**
   * 广播结算后新出现的淘汰。
   * `directPlayerId` = 本次触发的直接受害者（forfeit 的目标 / 僵局判负的当前玩家），
   * 使用触发方声明的原因；结算链中连带僵局淘汰的其他玩家原因恒为 noLegalAction。
   */
  function announceEliminations(
    previous: GameState,
    reason: EliminationReason,
    directPlayerId?: PlayerId,
  ): void {
    if (!state) return;
    for (const player of state.players) {
      const before = previous.players.find((q) => q.id === player.id);
      if (player.eliminated === true && before?.eliminated !== true) {
        const playerReason =
          directPlayerId !== undefined && player.id !== directPlayerId
            ? ('noLegalAction' as EliminationReason)
            : reason;
        broadcast({ type: 'eliminated', playerId: player.id, reason: playerReason });
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
    if (debug) console.log(`[diag] forfeit t=${Date.now()} room=${config.roomId} player=${playerId} reason=${reason}`);
    announceEliminations(previous, reason, playerId);
    cancelBrokenDrawOffer();
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
    drawOfferCounts.clear();
    pendingDraw = null;
    rematchReady.clear();
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
    resumeFromIdle(); // 有人入座：结束空闲暂停
    connection.send({
      type: 'welcome',
      roomId: config.roomId,
      playerId: seatId,
      token: seat.token,
      status,
      config: configInfo(),
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
    resumeFromIdle(); // 有人回归：结束空闲暂停（计时以暂停时剩余值继续）
    connection.send({
      type: 'welcome',
      roomId: config.roomId,
      playerId: seat.playerId,
      token,
      status,
      config: configInfo(),
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

    // 空房间生命周期：全部离线时——等待房自毁（防“自己和自己联机” seat 占位）；
    // 对局房暂停计时并标记 idle（保留状态供重连，TTL 回收由桥接执行）。
    if (onlineCount() === 0) {
      if (status === 'waiting') {
        config.onEmpty?.(config.roomId);
        return;
      }
      if (status === 'playing') pauseForIdle();
    }
  }

  /** 对局中全员离线：取消本回合 setTimeout，冻结剩余时间。 */
  function pauseForIdle(): void {
    if (idlePaused || turnDeadline === null) return;
    pausedRemainingMs = Math.max(0, turnDeadline - Date.now());
    timerGeneration += 1;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    turnDeadline = null;
    idlePaused = true;
  }

  /** 有人回归：以冻结的剩余时间继续计时。 */
  function resumeFromIdle(): void {
    if (!idlePaused) return;
    idlePaused = false;
    const remaining = pausedRemainingMs;
    pausedRemainingMs = null;
    if (remaining !== null && status === 'playing' && state?.status.kind === 'inProgress') {
      turnDeadline = Date.now() + remaining;
      const generation = timerGeneration;
      timer = setTimeout(() => {
        if (generation !== timerGeneration) return;
        const current = state?.currentPlayerId;
        if (current !== undefined) forfeit(current, 'timeout');
      }, remaining);
      timer.unref();
    }
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
    if (debug) console.log(`[diag] recv t=${Date.now()} room=${config.roomId} player=${playerId} turn=${state.turnNumber}`);
    const previous = state;
    state = engine.apply(state, action);
    if (debug) console.log(`[diag] applied t=${Date.now()} turn=${state.turnNumber}`);
    announceEliminations(previous, 'noLegalAction');
    cancelBrokenDrawOffer();
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
      case 'resign': {
        // 产品规则：只有当前行动玩家可以认输（非当前行动玩家权威拒绝）。
        if (state?.status.kind !== 'inProgress' || state.currentPlayerId !== playerId) {
          const seat0 = seats.get(playerId);
          seat0?.connection?.send({
            type: 'rejected',
            code: 'notCurrentPlayer',
            reason: '只有当前行动玩家可以认输',
          });
          if (debug) console.log(`[diag] resign dropped: player=${playerId} not current`);
          break;
        }
        forfeit(playerId, 'resign');
        break;
      }
      case 'drawOffer':
        handleDrawOffer(playerId);
        break;
      case 'drawResponse':
        handleDrawResponse(playerId, message.accept);
        break;
      case 'rematchReady':
        handleRematchReady(playerId);
        break;
    }
  }

  function activePlayerIds(): PlayerId[] {
    if (!state || state.status.kind !== 'inProgress') return [];
    return state.players
      .filter((p) => p.eliminated !== true)
      .map((p) => p.id);
  }

  /** 求和提议：对局中、发起者为存活玩家、无待回应提议、次数未满（每人每局 3 次）。 */
  function handleDrawOffer(playerId: PlayerId): void {
    // 产品规则：只有当前行动玩家可以发起求和（非当前行动玩家权威拒绝）。
    if (state?.status.kind === 'inProgress' && state.currentPlayerId !== playerId) {
      const seat = seats.get(playerId);
      seat?.connection?.send({
        type: 'rejected',
        code: 'notCurrentPlayer',
        reason: '只有当前行动玩家可以发起求和',
      });
      if (debug) console.log(`[diag] drawOffer dropped: not current player=${playerId}`);
      return;
    }
    const seat = seats.get(playerId);
    if (status !== 'playing' || !seat?.connected) {
      seat?.connection?.send({ type: 'rejected', code: 'drawRejected', reason: '当前不能发起求和' });
      return;
    }
    if (state?.status.kind !== 'inProgress') {
      seat.connection?.send({ type: 'rejected', code: 'drawRejected', reason: '当前不能发起求和' });
      return;
    }
    if (pendingDraw !== null) {
      seat.connection?.send({ type: 'rejected', code: 'drawPending', reason: '已有待回应的求和提议' });
      return;
    }
    if (activePlayerIds().length < 2) {
      seat.connection?.send({ type: 'rejected', code: 'drawRejected', reason: '当前不能求和' });
      return;
    }
    const count = drawOfferCounts.get(playerId) ?? 0;
    if (count >= MAX_DRAW_OFFERS) {
      seat.connection?.send({ type: 'rejected', code: 'drawLimit', reason: '求和次数已用完（3/3）' });
      return;
    }
    const newCount = count + 1;
    drawOfferCounts.set(playerId, newCount);
    pendingDraw = {
      from: playerId,
      awaiting: activePlayerIds().filter((id) => id !== playerId),
    };
    broadcast({ type: 'drawOffer', fromPlayerId: playerId, count: newCount, max: MAX_DRAW_OFFERS });
  }

  /** 求和回应：全部存活玩家同意 → 权威和棋；任一拒绝 → 继续（次数已消耗）。 */
  function handleDrawResponse(playerId: PlayerId, accept: boolean): void {
    if (pendingDraw === null || !pendingDraw.awaiting.includes(playerId)) return;
    const from = pendingDraw.from;
    broadcast({ type: 'drawResponse', fromPlayerId: playerId, accept });
    if (!accept) {
      pendingDraw = null; // 拒绝：对局继续（发起者次数已消耗）
      return;
    }
    pendingDraw = { ...pendingDraw, awaiting: pendingDraw.awaiting.filter((id) => id !== playerId) };
    if (pendingDraw.awaiting.length === 0) {
      // 全体存活玩家同意：权威和棋（产品级终局，服务器权威判定）。
      pendingDraw = null;
      if (state && state.status.kind === 'inProgress') {
        state = { ...state, status: { kind: 'drawn', reason: { kind: 'agreement' } } };
        finish();
      }
    }
  }

  /** 结算后清理失效的求和提议（响应者被淘汰/离开时提议作废，视为被拒）。 */
  function cancelBrokenDrawOffer(): void {
    if (pendingDraw === null) return;
    if (seats.get(pendingDraw.from)?.connected !== true) {
      const from = pendingDraw.from;
      pendingDraw = null;
      broadcast({ type: 'drawResponse', fromPlayerId: from, accept: false });
      return;
    }
    const broken = pendingDraw.awaiting.find((id) => {
      const seat = seats.get(id);
      const player = state?.players.find((p) => p.id === id);
      return !seat?.connected || player?.eliminated === true;
    });
    if (broken !== undefined) {
      const from = pendingDraw.from;
      pendingDraw = null;
      broadcast({ type: 'drawResponse', fromPlayerId: broken, accept: false });
    }
  }

  /** 再来一局：terminal 后已连接玩家依次准备，全员准备 → 以原房间配置开新局。 */
  function handleRematchReady(playerId: PlayerId): void {
    if (status !== 'finished') return;
    const seat = seats.get(playerId);
    if (!seat?.connected) return;
    rematchReady.add(playerId);
    broadcastRoomStatus();
    const connectedSeats = [...seats.values()].filter((s) => s.connected);
    if (connectedSeats.length === config.seatIds.length && connectedSeats.every((s) => rematchReady.has(s.playerId))) {
      status = 'waiting'; // start() 的守卫要求 waiting；座位/令牌/配置全部保持
      start(); // 同房间/同座位/同配置的新 GameState（start 内部重置 rematch/求和状态）
    }
  }

  return {
    roomId: config.roomId,
    join,
    rejoin,
    disconnect,
    handleClientMessage,
    forfeit,
    close: () => {
      disarmTimer();
      idlePaused = false;
      pausedRemainingMs = null;
    },
    getState: () => state,
    getStatus: () => status,
    timerPolicyMs: () => config.turnTimeoutMs,
    rematchReadyPlayers: () => [...rematchReady],
    configInfo,
    onlineCount,
    playersInfo: () => [...seats.values()].map(seatInfo),
  };
}
