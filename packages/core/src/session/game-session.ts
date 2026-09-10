import { createEngine } from '../engine/game-engine';
import type { GameState } from '../model/game-state';
import type { PlayerId } from '../model/ids';
import type { GameMode } from '../modes/game-mode';
import { validateCommand } from './command';
import type { CommandEnvelope, CommandErrorCode } from './command';

/** 状态更新监听器；回调参数为权威方发布的最新状态。 */
export type SessionListener = (state: GameState) => void;

/** 取消订阅。 */
export type Unsubscribe = () => void;

/**
 * 单次提交的即时结果。accepted 附带执行后的新状态（本地权威场景立即可用）；
 * 远程会话中该结果只代表“本地已接受发送”，权威结果以 subscribe 到达的状态为准。
 */
export type CommandOutcome =
  | { readonly kind: 'accepted'; readonly state: GameState }
  | { readonly kind: 'rejected'; readonly code: CommandErrorCode; readonly reason: string };

/**
 * 会话：客户端与“权威执行方”之间的唯一通道（传输无关）。
 *
 * 客户端不再自己执行状态转移，只做两件事：
 * - `submit` 提交带发送者的指令（远程实现下为异步发送，返回值只代表本地受理结果）；
 * - `subscribe` 接收权威方发布的最新状态。
 * `forfeit` 是权威判负入口（超时/认输）：仅权威方（本地会话自身 / 未来服务端
 * 的计时器与认输处理）可调用，客户端不得借此自行修改淘汰状态。
 * 本地实现中 submit/forfeit 同步生效；未来以 WebSocket 实现同一接口时 UI 代码无需改变。
 */
export interface GameSession {
  /** 当前权威状态快照（只读）。 */
  getState(): GameState;
  /** 提交一条指令；被拒绝时不产生任何状态变更。 */
  submit(command: CommandEnvelope): CommandOutcome;
  /** 权威判负：淘汰指定玩家（超时/认输）并重新结算终局。 */
  forfeit(playerId: PlayerId): CommandOutcome;
  /** 订阅权威状态更新。 */
  subscribe(listener: SessionListener): Unsubscribe;
}

export interface LocalSessionOptions {
  /** 初始洗牌种子（可复现对局）。 */
  readonly seed?: number;
  /** 直接以给定状态开局（存档恢复/测试）；提供时忽略 seed，合法性由调用方保证。 */
  readonly initialState?: GameState;
}

/**
 * 本地会话（单机热座 / loopback 传输的最简实现）：会话自身即权威执行方。
 * 指令在 submit 内同步完成“校验发送者 -> 应用动作 -> 发布新状态”。
 */
export function createLocalSession(mode: GameMode, options: LocalSessionOptions = {}): GameSession {
  const engine = createEngine(mode);
  let state: GameState = options.initialState ?? mode.createInitialState(options.seed);
  const listeners = new Set<SessionListener>();

  function emit() {
    for (const listener of listeners) listener(state);
  }

  return {
    getState() {
      return state;
    },
    submit(command) {
      const check = validateCommand(engine, state, command);
      if (!check.legal) {
        return { kind: 'rejected', code: check.code, reason: check.reason };
      }
      state = engine.apply(state, command.action);
      emit();
      return { kind: 'accepted', state };
    },
    forfeit(playerId) {
      // 与 validateCommand 同级的入口前置校验，保证拒绝时给出结构化原因码。
      if (state.status.kind !== 'inProgress') {
        return { kind: 'rejected', code: 'gameOver', reason: '对局已结束，不能判负' };
      }
      const target = state.players.find((p) => p.id === playerId);
      if (!target) {
        return { kind: 'rejected', code: 'unknownPlayer', reason: `未知玩家: ${playerId}` };
      }
      if (target.eliminated === true) {
        return { kind: 'rejected', code: 'playerEliminated', reason: '该玩家已被淘汰' };
      }
      state = engine.forfeit(state, playerId);
      emit();
      return { kind: 'accepted', state };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
