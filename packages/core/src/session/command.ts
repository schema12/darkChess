import type { GameEngine } from '../engine/game-engine';
import type { GameAction } from '../model/action';
import type { GameState } from '../model/game-state';
import type { PlayerId } from '../model/ids';

/**
 * 动作信封：在纯规则层面的 GameAction 之上叠加“提交者是谁”。
 *
 * GameAction 只描述棋盘上发生什么（翻棋/移动），不含发送者；
 * “谁提交的”属于协议层概念，因此用信封包装而不是塞进 GameAction。
 * 这样 actionLog / 回放 / 序列化继续只依赖规则语义；
 * 序号、时间戳等传输层字段留待真正联网时由传输层扩展，不在此预设。
 */
export interface CommandEnvelope {
  /** 提交该动作的玩家（座位）id。 */
  readonly playerId: PlayerId;
  readonly action: GameAction;
}

/** 指令被权威方拒绝的结构化原因码（供传输层映射为协议错误 / UI 提示）。 */
export type CommandErrorCode =
  | 'gameOver' // 对局已结束，不再接受任何指令
  | 'unknownPlayer' // 提交者不在本局玩家列表中
  | 'playerEliminated' // 提交者已被判负淘汰，永远不能再次行动
  | 'notCurrentPlayer' // 提交者存在但尚未轮到他行动
  | 'illegalAction'; // 发送者正确，但动作本身不合法

/** 权威校验结果：结构化 code + 人类可读 reason，与 MoveValidation 的定位分层。 */
export type CommandValidation =
  | { readonly legal: true }
  | { readonly legal: false; readonly code: CommandErrorCode; readonly reason: string };

/**
 * 权威校验：按 “对局是否结束 -> 提交者是谁 -> 是否已被淘汰 -> 是否轮到他 ->
 * 动作是否合法” 的顺序拒绝。发送者校验先于动作校验，不向未授权提交者泄露
 * 规则层的拒绝细节。纯函数，不修改状态；这是未来服务端复用的同一份逻辑。
 */
export function validateCommand(
  engine: GameEngine,
  state: GameState,
  command: CommandEnvelope,
): CommandValidation {
  if (state.status.kind !== 'inProgress') {
    return { legal: false, code: 'gameOver', reason: '对局已结束，不再接受指令' };
  }
  const sender = state.players.find((p) => p.id === command.playerId);
  if (!sender) {
    return { legal: false, code: 'unknownPlayer', reason: `未知玩家: ${command.playerId}` };
  }
  if (sender.eliminated === true) {
    return { legal: false, code: 'playerEliminated', reason: '该玩家已被淘汰，不能提交行动' };
  }
  if (command.playerId !== state.currentPlayerId) {
    return { legal: false, code: 'notCurrentPlayer', reason: '尚未轮到该玩家行动' };
  }
  const actionCheck = engine.validate(state, command.action);
  if (!actionCheck.legal) {
    return { legal: false, code: 'illegalAction', reason: actionCheck.reason };
  }
  return { legal: true };
}

/**
 * 权威执行入口：校验通过才应用动作并返回新状态，任何校验失败都抛错。
 * 未来 apps/server 的每个房间持有 engine，对每条客户端消息调用本函数，
 * 失败时把 CommandValidation 的结构化 code/reason 回传客户端，而不是下发异常细节。
 * 本地会话（game-session.ts）则用 validateCommand + engine.apply 以“返回结果”代替抛错。
 */
export function applyCommand(
  engine: GameEngine,
  state: GameState,
  command: CommandEnvelope,
): GameState {
  const check = validateCommand(engine, state, command);
  if (!check.legal) {
    throw new Error(`非法指令 (${check.code}): ${check.reason}`);
  }
  return engine.apply(state, command.action);
}
