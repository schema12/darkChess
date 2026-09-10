import { describe, expect, it } from 'vitest';
import { createEngine } from '../engine/game-engine';
import type { GameState } from '../model/game-state';
import {
  deserializeGameState,
  serializeGameState,
} from '../model/serialization';
import { createDarkChess4x8Mode } from '../modes/dark-chess-4x8';
import { createDarkChess3p4x8Mode } from '../modes/dark-chess-3p-4x8';
import { mulberry32 } from '../rng/rng';
import { buildState } from '../testing/helpers';
import { applyCommand, validateCommand } from './command';
import type { CommandEnvelope } from './command';
import { createLocalSession } from './game-session';

const mode = createDarkChess4x8Mode();
const engine = createEngine(mode);

/** 以指定玩家的名义包装一个翻棋动作。 */
function revealAs(playerId: string, state: GameState): CommandEnvelope {
  const action = engine.getLegalActions(state).find((a) => a.kind === 'reveal');
  if (!action) throw new Error('测试前置失败: 没有可用的翻棋动作');
  return { playerId, action };
}

describe('指令信封与权威校验（validateCommand / applyCommand）', () => {
  it('当前回合玩家提交合法指令：通过校验并推进状态', () => {
    const state0 = mode.createInitialState(1);
    const command = revealAs('A', state0);
    expect(validateCommand(engine, state0, command)).toEqual({ legal: true });

    const state1 = applyCommand(engine, state0, command);
    expect(state1.turnNumber).toBe(1);
    expect(state1.currentPlayerId).not.toBe(state0.currentPlayerId);
    expect(state1.actionLog[state1.actionLog.length - 1]?.playerId).toBe('A');
  });

  it('非当前回合玩家提交：拒绝（notCurrentPlayer），applyCommand 抛错且不改状态', () => {
    const state0 = mode.createInitialState(1);
    const command = revealAs('B', state0); // A 先手

    expect(validateCommand(engine, state0, command)).toMatchObject({
      legal: false,
      code: 'notCurrentPlayer',
    });
    expect(() => applyCommand(engine, state0, command)).toThrow(/notCurrentPlayer/);
    expect(state0.turnNumber).toBe(0);
  });

  it('未知玩家提交：拒绝（unknownPlayer）', () => {
    const state0 = mode.createInitialState(1);
    expect(validateCommand(engine, state0, revealAs('Z', state0))).toMatchObject({
      legal: false,
      code: 'unknownPlayer',
    });
  });

  it('发送者校验优先于动作合法性校验', () => {
    const state0 = mode.createInitialState(1);
    // B 提交一个本身也不合法的动作（移动未翻开棋子）——应先按发送者拒绝。
    const command: CommandEnvelope = {
      playerId: 'B',
      action: { kind: 'move', from: { x: 0, y: 0 }, to: { x: 0, y: 1 } },
    };
    expect(validateCommand(engine, state0, command)).toMatchObject({
      legal: false,
      code: 'notCurrentPlayer',
    });
  });

  it('当前玩家提交不合法动作：拒绝（illegalAction）', () => {
    const state0 = mode.createInitialState(1);
    const command: CommandEnvelope = {
      playerId: 'A',
      action: { kind: 'move', from: { x: 0, y: 0 }, to: { x: 0, y: 1 } }, // 未翻开的棋子不能移动
    };
    expect(validateCommand(engine, state0, command)).toMatchObject({
      legal: false,
      code: 'illegalAction',
    });
  });

  it('对局结束后：拒绝任何指令（gameOver），先于发送者校验', () => {
    const won = engine.apply(
      buildState(
        [
          { x: 1, y: 1, type: 'ROOK', color: 'BLACK', revealed: true },
          { x: 2, y: 1, type: 'PAWN', color: 'RED', revealed: true },
        ],
        { currentPlayer: 'B' },
      ),
      { kind: 'move', from: { x: 1, y: 1 }, to: { x: 2, y: 1 } },
    );
    expect(won.status.kind).toBe('won');

    const command: CommandEnvelope = {
      playerId: won.currentPlayerId,
      action: { kind: 'reveal', position: { x: 0, y: 0 } },
    };
    expect(validateCommand(engine, won, command)).toMatchObject({
      legal: false,
      code: 'gameOver',
    });
  });
});

describe('本地会话（createLocalSession）', () => {
  it('初始状态与 mode.createInitialState 一致且可复现', () => {
    expect(createLocalSession(mode, { seed: 7 }).getState()).toEqual(mode.createInitialState(7));
  });

  it('支持以既有状态开局（存档恢复路径）', () => {
    const restored = mode.createInitialState(3);
    expect(createLocalSession(mode, { initialState: restored }).getState()).toEqual(restored);
  });

  it('接受合法指令：状态推进并通知订阅者', () => {
    const session = createLocalSession(mode, { seed: 1 });
    const seen: GameState[] = [];
    session.subscribe((s) => seen.push(s));

    const outcome = session.submit(revealAs('A', session.getState()));

    expect(outcome.kind).toBe('accepted');
    if (outcome.kind !== 'accepted') return;
    expect(outcome.state.turnNumber).toBe(1);
    expect(session.getState()).toBe(outcome.state);
    expect(seen).toEqual([outcome.state]);
  });

  it('拒绝非法指令：返回结构化原因，状态与订阅者均不受影响', () => {
    const session = createLocalSession(mode, { seed: 1 });
    const seen: GameState[] = [];
    session.subscribe((s) => seen.push(s));

    const before = session.getState();
    const outcome = session.submit(revealAs('B', before)); // A 先手

    expect(outcome).toMatchObject({ kind: 'rejected', code: 'notCurrentPlayer' });
    expect(session.getState()).toBe(before);
    expect(seen).toHaveLength(0);
  });

  it('取消订阅后不再收到状态更新', () => {
    const session = createLocalSession(mode, { seed: 1 });
    const seen: GameState[] = [];
    const unsubscribe = session.subscribe((s) => seen.push(s));
    unsubscribe();

    session.submit(revealAs('A', session.getState()));
    expect(seen).toHaveLength(0);
  });

  it('整局冒烟：通过会话提交指令可完整进行到终局', () => {
    const session = createLocalSession(mode, { seed: 42 });
    const rng = mulberry32(999);
    let moves = 0;

    while (session.getState().status.kind === 'inProgress' && moves < 500) {
      const state = session.getState();
      const actions = engine.getLegalActions(state);
      const action = actions[rng.nextInt(actions.length)]!;
      const outcome = session.submit({ playerId: state.currentPlayerId, action });
      expect(outcome.kind).toBe('accepted');
      moves += 1;
      expect(session.getState().turnNumber).toBe(moves);
    }

    expect(session.getState().status.kind).not.toBe('inProgress');
  });
});

describe('权威判负（forfeit）与淘汰玩家提交', () => {
  const mode3p = createDarkChess3p4x8Mode();
  const engine3p = createEngine(mode3p);

  it('forfeit 淘汰当前玩家并轮转；淘汰玩家提交任何动作被拒（playerEliminated）', () => {
    const session = createLocalSession(mode3p, { seed: 1 });
    const outcome = session.forfeit('A');
    expect(outcome.kind).toBe('accepted');

    const state = session.getState();
    expect(state.players.find((p) => p.id === 'A')?.eliminated).toBe(true);
    expect(state.currentPlayerId).toBe('B');
    expect(state.status.kind).toBe('inProgress');

    // 淘汰玩家不能提交 Reveal —— playerEliminated 先于 notCurrentPlayer 判定。
    const reveal = engine3p.getLegalActions(state).find((a) => a.kind === 'reveal');
    expect(reveal).toBeDefined();
    expect(session.submit({ playerId: 'A', action: reveal! })).toMatchObject({
      kind: 'rejected',
      code: 'playerEliminated',
    });

    // 移动/吃子同样被拒（用一个具体非法动作验证拒绝码优先级一致）。
    const illegalMove = session.submit({
      playerId: 'A',
      action: { kind: 'move', from: { x: 0, y: 0 }, to: { x: 0, y: 1 } },
    });
    expect(illegalMove).toMatchObject({ kind: 'rejected', code: 'playerEliminated' });
  });

  it('连续 forfeit 两名玩家：最后一名未淘汰玩家立即获胜（未绑定阵营以 winnerPlayerId 表达）', () => {
    const session = createLocalSession(mode3p, { seed: 1 });
    session.forfeit('A');
    const outcome = session.forfeit('B');
    expect(outcome.kind).toBe('accepted');

    const state = session.getState();
    expect(state.currentPlayerId).toBe('C'); // 轮转不会落在已淘汰玩家身上
    expect(state.status).toEqual({ kind: 'won', winner: null, winnerPlayerId: 'C' });

    // 新形状可完整序列化往返（eliminated + winnerPlayerId + winner=null）。
    expect(deserializeGameState(serializeGameState(state))).toEqual(state);

    // 终局后不再接受任何判负。
    expect(session.forfeit('C')).toMatchObject({ kind: 'rejected', code: 'gameOver' });
  });

  it('forfeit 未知/已淘汰玩家被拒（结构化原因码）', () => {
    const session = createLocalSession(mode3p, { seed: 1 });
    expect(session.forfeit('Z')).toMatchObject({ kind: 'rejected', code: 'unknownPlayer' });
    expect(session.forfeit('A')).toMatchObject({ kind: 'accepted' });
    expect(session.forfeit('A')).toMatchObject({ kind: 'rejected', code: 'playerEliminated' });
  });
});
