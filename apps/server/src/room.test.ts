import { describe, expect, it } from 'vitest';
import { createDarkChess3p4x8Mode } from '@darkchess/core';
import type { GameAction, GameState } from '@darkchess/core';
import { createGameRoom } from './room';
import type { GameRoom, RoomConnection } from './room';
import type { ServerMessage } from './protocol';

const SEATS = ['A', 'B', 'C'] as const;

function fakeConnection() {
  const messages: ServerMessage[] = [];
  const connection: RoomConnection = {
    send(message) {
      messages.push(message);
    },
    close() {},
  };
  return {
    connection,
    messages,
    lastOfType<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> | null {
      const found = messages.filter((m) => m.type === type);
      return (found[found.length - 1] ?? null) as Extract<ServerMessage, { type: T }> | null;
    },
    states(): GameState[] {
      return messages.filter((m) => m.type === 'state').map((m) => (m as { state: GameState }).state);
    },
  };
}

function makeRoom(turnTimeoutMs?: number): GameRoom {
  return createGameRoom({
    roomId: 'room-test',
    mode: createDarkChess3p4x8Mode(),
    seatIds: [...SEATS],
    seed: 42,
    turnTimeoutMs,
  });
}

function joinThree(room: GameRoom) {
  const a = fakeConnection();
  const b = fakeConnection();
  const c = fakeConnection();
  const ra = room.join(a.connection);
  const rb = room.join(b.connection);
  const rc = room.join(c.connection);
  return { a, b, c, ra, rb, rc };
}

/** 当前玩家的合法动作（开局时必为翻棋）。 */
function revealAction(position: { x: number; y: number }): GameAction {
  return { kind: 'reveal', position };
}

describe('GameRoom：入座与开局', () => {
  it('三人加入满员自动开局：座位/令牌由服务端分配，广播同一权威初始状态', () => {
    const room = makeRoom();
    const { a, b, c, ra, rb, rc } = joinThree(room);

    expect(room.getStatus()).toBe('playing');
    expect([ra.playerId, rb.playerId, rc.playerId]).toEqual(['A', 'B', 'C']);
    // 令牌各不相同（重连凭据）。
    expect(new Set([ra.token, rb.token, rc.token]).size).toBe(3);

    const states = [a.states(), b.states(), c.states()];
    for (const list of states) expect(list).toHaveLength(1);
    expect(states[0]![0]).toEqual(states[1]![0]);
    expect(states[1]![0]).toEqual(states[2]![0]);
    expect(states[0]![0]!.board.cells).toHaveLength(32);
  });

  it('第四人加入被拒（满员且已开局 → roomClosed），房间状态不受影响', () => {
    const room = makeRoom();
    joinThree(room);
    const fourth = fakeConnection();
    const result = room.join(fourth.connection);

    expect(result.ok).toBe(false);
    // room.join 现在只返回结构化 code，rejected 由桥接层发送（终端房替换逻辑所在层）。
    expect(result.code).toBe('roomClosed');
    expect(room.getStatus()).toBe('playing');
    expect(room.playersInfo()).toHaveLength(3);
  });
});

describe('GameRoom：指令执行与安全边界', () => {
  it('非当前玩家的指令被拒（notCurrentPlayer），权威状态不变', () => {
    const room = makeRoom();
    const { b } = joinThree(room);

    room.handleClientMessage('B', { type: 'command', action: revealAction({ x: 0, y: 0 }) });

    expect(b.lastOfType('rejected')).toMatchObject({ code: 'notCurrentPlayer' });
    expect(room.getState()?.turnNumber).toBe(0);
  });

  it('非法指令被拒（illegalAction）：未翻开的棋子不能移动', () => {
    const room = makeRoom();
    const { a } = joinThree(room);

    room.handleClientMessage('A', {
      type: 'command',
      action: { kind: 'move', from: { x: 0, y: 0 }, to: { x: 0, y: 1 } },
    });

    expect(a.lastOfType('rejected')).toMatchObject({ code: 'illegalAction' });
    expect(room.getState()?.turnNumber).toBe(0);
  });

  it('伪造 playerId 无效：消息体携带他人身份也被按连接身份处理', () => {
    const room = makeRoom();
    const { b } = joinThree(room); // 当前玩家是 A

    // 消息体塞入 playerId: 'A' 试图冒充当前玩家——房间只认连接绑定的 'B'。
    const forged = {
      type: 'command',
      action: revealAction({ x: 0, y: 0 }),
      playerId: 'A',
    } as unknown as { type: 'command'; action: GameAction };
    room.handleClientMessage('B', { type: 'command', action: forged.action });

    expect(b.lastOfType('rejected')).toMatchObject({ code: 'notCurrentPlayer' });
    expect(room.getState()?.turnNumber).toBe(0);
  });

  it('服务端执行合法指令并广播：三个客户端最终收到一致的权威状态', () => {
    const room = makeRoom();
    const { a, b, c } = joinThree(room);

    room.handleClientMessage('A', { type: 'command', action: revealAction({ x: 0, y: 0 }) });
    room.handleClientMessage('B', { type: 'command', action: revealAction({ x: 1, y: 0 }) });

    expect(room.getState()?.turnNumber).toBe(2);
    const latest = [a.states().at(-1), b.states().at(-1), c.states().at(-1)];
    expect(latest[0]).toEqual(latest[1]);
    expect(latest[1]).toEqual(latest[2]);
    expect(latest[0]!.currentPlayerId).toBe('C');
  });

  it('resign（主动认输）：服务端权威淘汰，棋子保留，状态广播', () => {
    const room = makeRoom();
    const { a, b, c } = joinThree(room);

    room.handleClientMessage('A', { type: 'resign' });

    expect(room.getState()?.players.find((p) => p.id === 'A')?.eliminated).toBe(true);
    expect(room.getState()?.board.cells.filter((x) => x.piece !== null)).toHaveLength(32);
    expect(room.getState()?.currentPlayerId).toBe('B');
    expect(a.lastOfType('eliminated')).toMatchObject({ playerId: 'A', reason: 'resign' });
    // 三个客户端都收到淘汰事件与新状态。
    for (const client of [a, b, c]) {
      expect(client.lastOfType('eliminated')).toMatchObject({ playerId: 'A', reason: 'resign' });
      expect(client.states().at(-1)?.players.find((p) => p.id === 'A')?.eliminated).toBe(true);
    }
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('GameRoom：服务器回合计时与超时判负', () => {
  it('超时触发权威判负：当前玩家淘汰、轮转、广播 timeout 通知、棋子保留', async () => {
    const room = makeRoom(150);
    const { a, b } = joinThree(room);

    await sleep(220);

    expect(a.lastOfType('eliminated')).toMatchObject({ playerId: 'A', reason: 'timeout' });
    const state = room.getState();
    expect(state?.players.find((p) => p.id === 'A')?.eliminated).toBe(true);
    expect(state?.currentPlayerId).toBe('B');
    expect(state?.board.cells.filter((c) => c.piece !== null)).toHaveLength(32); // 判负不删子
    expect(room.getStatus()).toBe('playing'); // 两名玩家继续
    expect(b.states().at(-1)?.players.find((p) => p.id === 'A')?.eliminated).toBe(true);
    room.close();
  });

  it('正常行动重置计时：连续快步不触发超时', async () => {
    const room = makeRoom(90);
    joinThree(room);

    const positions = [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 },
      { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 },
    ];
    for (const position of positions) {
      await sleep(30); // 远小于 90ms，每次行动都应重置计时
      const current = room.getState()!.currentPlayerId;
      room.handleClientMessage(current, { type: 'command', action: revealAction(position) });
    }

    expect(room.getState()?.turnNumber).toBe(8);
    expect(room.getState()?.players.every((p) => p.eliminated !== true)).toBe(true);
    room.close();
  });

  it('连续两次超时：最后一名未淘汰玩家立即获胜', async () => {
    const room = makeRoom(50);
    const { c } = joinThree(room);

    await sleep(220);

    expect(room.getStatus()).toBe('finished');
    expect(room.getState()?.status).toEqual({ kind: 'won', winner: null, winnerPlayerId: 'C' });
    expect(c.states().at(-1)?.status).toEqual({ kind: 'won', winner: null, winnerPlayerId: 'C' });
    // 三名玩家的棋子全部保留（超时不删子）。
    expect(room.getState()?.board.cells.filter((x) => x.piece !== null)).toHaveLength(32);
    room.close();
  });

  it('未配置计时不超时', async () => {
    const room = makeRoom();
    joinThree(room);
    await sleep(220);
    expect(room.getState()?.players.every((p) => p.eliminated !== true)).toBe(true);
    expect(room.getState()?.turnNumber).toBe(0);
    room.close();
  });
});

describe('GameRoom：断线与重连', () => {
  it('断线保留座位与身份，对局继续', () => {
    const room = makeRoom();
    const { b, rb } = joinThree(room);
    room.disconnect(b.connection);

    expect(room.playersInfo().find((p) => p.playerId === 'B')?.connected).toBe(false);
    expect(room.getStatus()).toBe('playing');
    // A 仍可行动：对局不因断线中断。
    room.handleClientMessage('A', { type: 'command', action: revealAction({ x: 0, y: 0 }) });
    expect(room.getState()?.turnNumber).toBe(1);
    expect(rb.token).toBeDefined();
  });

  it('rejoin 凭令牌恢复原 playerId 并收到最新权威状态', () => {
    const room = makeRoom();
    const { b, rb } = joinThree(room);
    room.handleClientMessage('A', { type: 'command', action: revealAction({ x: 0, y: 0 }) });
    room.disconnect(b.connection);

    const again = fakeConnection();
    const result = room.rejoin(rb.token!, again.connection);

    expect(result.ok).toBe(true);
    expect(result.playerId).toBe('B'); // 同一座位，不新建玩家
    expect(again.states().at(-1)?.turnNumber).toBe(1); // 恢复当前权威状态
    expect(room.playersInfo().find((p) => p.playerId === 'B')?.connected).toBe(true);
  });

  it('错误令牌被拒（invalidToken）', () => {
    const room = makeRoom();
    joinThree(room);
    const again = fakeConnection();
    const result = room.rejoin('bad-token', again.connection);

    expect(result.ok).toBe(false);
    expect(again.lastOfType('rejected')).toMatchObject({ code: 'invalidToken' });
  });

  it('已淘汰玩家重连后不能行动', () => {
    const room = makeRoom();
    const { ra } = joinThree(room);
    room.forfeit('A', 'timeout');

    const again = fakeConnection();
    room.rejoin(ra.token!, again.connection);
    expect(room.playersInfo().find((p) => p.playerId === 'A')?.eliminated).toBe(true);

    room.handleClientMessage('A', { type: 'command', action: revealAction({ x: 0, y: 0 }) });
    expect(again.lastOfType('rejected')).toMatchObject({ code: 'playerEliminated' });
  });

  it('断线期间超时照常判负；重连后看到自己已被淘汰且不能行动', async () => {
    const room = makeRoom(150);
    const { a, b, rb } = joinThree(room);
    room.handleClientMessage('A', { type: 'command', action: revealAction({ x: 0, y: 0 }) });
    room.disconnect(b.connection); // B 掉线，计时继续

    await sleep(220);
    expect(room.getState()?.players.find((p) => p.id === 'B')?.eliminated).toBe(true);
    expect(room.getState()?.currentPlayerId).toBe('C');

    const again = fakeConnection();
    room.rejoin(rb.token!, again.connection);
    expect(again.states().at(-1)?.players.find((p) => p.id === 'B')?.eliminated).toBe(true);

    room.handleClientMessage('B', { type: 'command', action: revealAction({ x: 1, y: 0 }) });
    expect(again.lastOfType('rejected')).toMatchObject({ code: 'playerEliminated' });
    room.close();
  });
});
