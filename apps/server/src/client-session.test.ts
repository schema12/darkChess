import { afterAll, describe, expect, it } from 'vitest';
import {
  createDarkChess3p4x8Mode,
  createEngine,
  mulberry32,
} from '@darkchess/core';
import type { GameAction, GameState } from '@darkchess/core';
import { startDarkChessServer } from './index';
import type { RunningServer } from './index';
import { connectWebSocketGameSession } from './client/websocket-session';
import type { WebSocketGameSession } from './client/websocket-session';

const mode = createDarkChess3p4x8Mode();
const engine = createEngine(mode); // 与服务器同源的客户端视图推导

const servers: RunningServer[] = [];
let serverPort = 0;

async function startServer(options: Parameters<typeof startDarkChessServer>[0]): Promise<RunningServer> {
  const running = await startDarkChessServer(options);
  servers.push(running);
  serverPort = running.port;
  return running;
}

afterAll(async () => {
  for (const running of servers) await running.close();
});

interface ClientHarness {
  session: WebSocketGameSession;
  rejections: Array<{ code: string; reason: string }>;
  eliminations: Array<{ playerId: string; reason: string }>;
  /** 该会话收到的全部权威状态（经连接级 onState 记录，无遗漏）。 */
  states: GameState[];
  /** 等待下一条广播状态（游标消费，无注册竞态）。 */
  nextState(timeoutMs?: number): Promise<GameState>;
}

async function join(roomId: string): Promise<ClientHarness> {
  const rejections: ClientHarness['rejections'] = [];
  const eliminations: ClientHarness['eliminations'] = [];
  const states: GameState[] = [];
  let cursor = 0;
  const session = await connectWebSocketGameSession({
    url: `ws://localhost:${serverPort}`,
    roomId,
    onState: (s) => states.push(s),
    onRejected: (r) => rejections.push(r),
    onEliminated: (e) => eliminations.push(e),
  });
  return {
    session,
    rejections,
    eliminations,
    states,
    nextState(timeoutMs = 2000) {
      return new Promise<GameState>((resolve, reject) => {
        const check = () => {
          if (states.length > cursor) {
            clearInterval(poll);
            cursor += 1;
            resolve(states[cursor - 1]!);
          }
        };
        const timer = setTimeout(() => {
          clearInterval(poll);
          reject(new Error('等待广播状态超时'));
        }, timeoutMs);
        const poll = setInterval(check, 5);
        check();
      });
    },
  };
}

/** 三人顺序入座：订阅先于开局广播注册，消除竞态。 */
async function joinThree(roomId: string): Promise<[ClientHarness, ClientHarness, ClientHarness]> {
  const a = await join(roomId);
  const b = await join(roomId);
  const c = await join(roomId);
  const states = await Promise.all([a.nextState(), b.nextState(), c.nextState()]);
  for (const s of states) expect(s).toEqual(states[0]);
  return [a, b, c];
}

function reveal(position: { x: number; y: number }): GameAction {
  return { kind: 'reveal', position };
}

async function until(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('条件等待超时');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('WebSocketGameSession：连接与权威执行', () => {
  it('connect → 服务端分配身份 → 等待期状态为 null → 满员开局广播 → submit → 权威更新', async () => {
    const server = await startServer({
      mode,
      seatIds: ['A', 'B', 'C'],
      seed: 11,
      roomId: 's7-single',
    });

    const client = await join('s7-single');
    expect(client.session.playerId).toBe('A');
    expect(client.session.roomId).toBe('s7-single');
    expect(client.session.token).toBeTruthy();
    // 房间等待玩家加入：尚未开局，权威状态为 null。
    expect(client.session.getState()).toBeNull();
    expect(server.getRoom('s7-single')?.getStatus()).toBe('waiting');

    // 满员自动开局：三会话收到同一份权威初始状态。
    const [b, c] = [await join('s7-single'), await join('s7-single')];
    const pending = client.nextState();
    const firstStates = await Promise.all([pending, b.nextState(), c.nextState()]);
    expect(firstStates[0]!.board.cells).toHaveLength(32);
    expect(firstStates[0]!.turnNumber).toBe(0);
    expect(firstStates[0]!.currentPlayerId).toBe('A');
    expect(firstStates[1]).toEqual(firstStates[0]);
    expect(firstStates[2]).toEqual(firstStates[0]);

    // 先注册订阅，再提交：收到的下一条广播即权威执行结果。
    const updated = client.nextState();
    client.session.submit({ playerId: client.session.playerId, action: reveal({ x: 0, y: 0 }) });
    const next = await updated;

    expect(next.turnNumber).toBe(1);
    expect(next.currentPlayerId).toBe('B');
    expect(client.session.getState()!.turnNumber).toBe(1);

    // 非当前玩家提交 → 结构化拒绝，权威状态不变。
    client.session.submit({ playerId: 'A', action: reveal({ x: 1, y: 0 }) });
    await until(() => client.rejections.length > 0);
    expect(client.rejections[0]).toMatchObject({ code: 'notCurrentPlayer' });
    expect(client.session.getState()!.turnNumber).toBe(1);

    client.session.close();
  });

  it('伪造 playerId 无效：信封身份被忽略，按连接身份执行', async () => {
    await startServer({
      mode,
      seatIds: ['A', 'B', 'C'],
      seed: 12,
      roomId: 's7-forge',
    });
    const [a, b] = await joinThree('s7-forge'); // 开局后 A 先手

    // B 在信封里声明自己是 A——服务器按连接身份 B 处理（B 非当前玩家 → 拒绝）。
    b.session.submit({ playerId: 'A', action: reveal({ x: 0, y: 0 }) });
    await until(() => b.rejections.length > 0);
    expect(b.rejections[0]).toMatchObject({ code: 'notCurrentPlayer' });

    // A 正常翻棋后轮到 B；B 再次用伪造信封提交 → 按 B 执行（接受，轮到 C）。
    const bNext = b.nextState();
    a.session.submit({ playerId: 'A', action: reveal({ x: 0, y: 0 }) });
    await bNext;
    const cNext = b.nextState();
    b.session.submit({ playerId: 'A', action: reveal({ x: 1, y: 0 }) });
    const after = await cNext;
    expect(after.turnNumber).toBe(2);
    expect(after.currentPlayerId).toBe('C');
  });
});

describe('WebSocketGameSession：房间与淘汰', () => {
  it('三人加入同房；第四人连接被拒（roomClosed）', async () => {
    const server = await startServer({
      mode,
      seatIds: ['A', 'B', 'C'],
      seed: 13,
      roomId: 's7-full',
    });
    await joinThree('s7-full');
    expect(server.getRoom('s7-full')?.getStatus()).toBe('playing');

    await expect(
      connectWebSocketGameSession({ url: `ws://localhost:${serverPort}`, roomId: 's7-full' }),
    ).rejects.toThrow(/roomClosed/);
  });

  it('淘汰玩家会话提交被拒（playerEliminated），淘汰事件带服务器声明的原因', async () => {
    const server = await startServer({
      mode,
      seatIds: ['A', 'B', 'C'],
      seed: 14,
      roomId: 's7-elim',
    });
    const [a] = await joinThree('s7-elim');

    server.getRoom('s7-elim')!.forfeit('A', 'timeout'); // 服务器权威淘汰
    await until(() => a.eliminations.length > 0);
    expect(a.eliminations[0]).toMatchObject({ playerId: 'A', reason: 'timeout' });
    expect(a.session.getState()!.players.find((p) => p.id === 'A')?.eliminated).toBe(true);

    a.session.submit({ playerId: 'A', action: reveal({ x: 0, y: 0 }) });
    await until(() => a.rejections.length > 0);
    expect(a.rejections[0]).toMatchObject({ code: 'playerEliminated' });
  });
});

describe('WebSocketGameSession：服务器计时与重连', () => {
  it('超时 → 三会话同收 timeout 淘汰；两次超时 → 最后一名未淘汰玩家立即获胜', async () => {
    await startServer({
      mode,
      seatIds: ['A', 'B', 'C'],
      seed: 15,
      roomId: 's7-timeout',
      turnTimeoutMs: 150,
    });
    const [a, b, c] = await joinThree('s7-timeout');

    await until(() => a.eliminations.some((e) => e.playerId === 'A' && e.reason === 'timeout'));
    await until(() => b.eliminations.some((e) => e.playerId === 'B' && e.reason === 'timeout'));
    await until(() => a.session.getState()?.status.kind === 'won', 8000);

    const finalStates = [a, b, c].map((h) => h.session.getState()!);
    for (const state of finalStates) {
      expect(state.status).toEqual({ kind: 'won', winner: null, winnerPlayerId: 'C' });
      expect(state.board.cells.filter((x) => x.piece !== null)).toHaveLength(32); // 淘汰不删子
    }
    for (const harness of [a, b, c]) expect(harness.session.getState()).toEqual(finalStates[0]);
  });

  it('reconnect：令牌恢复原 playerId；已淘汰者重连后身份保持且不能行动', async () => {
    const server = await startServer({
      mode,
      seatIds: ['A', 'B', 'C'],
      seed: 16,
      roomId: 's7-rejoin',
    });
    const [a] = await joinThree('s7-rejoin');
    const token = a.session.token;

    // 服务器权威淘汰 A（超时语义）；等 A 收到广播快照后再断线（避免关闭竞态）。
    server.getRoom('s7-rejoin')!.forfeit('A', 'timeout');
    await until(() => a.eliminations.length > 0);
    a.session.close();

    const rejections: Array<{ code: string; reason: string }> = [];
    const again = await connectWebSocketGameSession({
      url: `ws://localhost:${serverPort}`,
      roomId: 's7-rejoin',
      token,
      onRejected: (r) => rejections.push(r),
    });

    // 恢复原座位与身份；不新建玩家、不重置棋局、不恢复行动资格。
    expect(again.playerId).toBe('A');
    expect(again.token).toBe(token);
    expect(again.getState()).toEqual(a.session.getState());
    expect(again.getState()!.players.find((p) => p.id === 'A')?.eliminated).toBe(true);

    again.submit({ playerId: 'A', action: reveal({ x: 2, y: 0 }) });
    await until(() => rejections.length > 0);
    expect(rejections[0]).toMatchObject({ code: 'playerEliminated' });
  });
});

describe('WebSocketGameSession：完整三人随机对局（三会话一致性）', () => {
  it('固定种子随机对局至终局：每步三方状态一致', async () => {
    await startServer({
      mode,
      seatIds: ['A', 'B', 'C'],
      seed: 777,
      roomId: 's7-fullgame',
    });

    const harnesses = await joinThree('s7-fullgame');
    let state: GameState = harnesses[0]!.session.getState()!;

    const rng = mulberry32(20260910);
    const byId = new Map(harnesses.map((h) => [h.session.playerId, h] as const));
    let turns = 0;

    while (state.status.kind === 'inProgress' && turns < 500) {
      const current = byId.get(state.currentPlayerId)!;
      // 客户端视图推导选动作；合法性最终由服务器权威判定。
      const actions = engine.getLegalActions(state);
      expect(actions.length).toBeGreaterThan(0);
      const action = actions[rng.nextInt(actions.length)]! as GameAction;

      const pending = harnesses.map((h) => h.nextState());
      current.session.submit({ playerId: current.session.playerId, action });
      const seen: GameState[] = [];
      for (const p of pending) seen.push(await p);

      state = seen[0]!;
      for (const s of seen) expect(s).toEqual(state); // 三方一致
      expect(state.turnNumber).toBe(turns + 1);
      expect(state.players.find((p) => p.id === state.currentPlayerId)?.eliminated).not.toBe(true);
      turns += 1;
    }

    expect(turns).toBeGreaterThan(0);
    expect(state.status.kind).not.toBe('inProgress'); // 正常终局
    for (const h of harnesses) expect(h.session.getState()).toEqual(state);
  }, 30000);
});
