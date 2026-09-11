import { afterAll, describe, expect, it } from 'vitest';
import {
  createDarkChess4x8Mode,
  createDarkChess3p4x8Mode,
  createEngine,
  mulberry32,
} from '@darkchess/core';
import type { GameAction, GameState } from '@darkchess/core';
import { startDarkChessServer } from './index';
import type { RunningServer } from './index';
import { connectWebSocketGameSession } from './client/websocket-session';
import type { WebSocketGameSession } from './client/websocket-session';

const mode = createDarkChess4x8Mode();
const mode3p = createDarkChess3p4x8Mode();
const engine = createEngine(mode);

const servers: RunningServer[] = [];
let serverPort = 0;

async function startServer(
  options: Parameters<typeof startDarkChessServer>[0],
): Promise<RunningServer> {
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
  states: GameState[];
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
    mode: '2p',
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
        const timer = setTimeout(() => {
          clearInterval(poll);
          reject(new Error('等待广播状态超时'));
        }, timeoutMs);
        const poll = setInterval(() => {
          if (states.length > cursor) {
            clearInterval(poll);
            cursor += 1;
            resolve(states[cursor - 1]!);
          }
        }, 5);
      });
    },
  };
}

async function until(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('条件等待超时');
    await new Promise((r) => setTimeout(r, 25));
  }
}

function reveal(position: { x: number; y: number }): GameAction {
  return { kind: 'reveal', position };
}

describe('联机 2P：房间与开局', () => {
  it('两人加入即满员开局：A/B 分配、waiting→playing、双方初始状态一致', async () => {
    const server = await startServer({
      mode,
      seatIds: ['A', 'B'],
      seed: 5,
      roomId: 'p2-room',
    });

    const a = await join('p2-room');
    expect(a.session.playerId).toBe('A');
    expect(server.getRoom('p2-room', '2p')?.getStatus()).toBe('waiting');

    const b = await join('p2-room');
    expect(b.session.playerId).toBe('B');
    const [stateA, stateB] = await Promise.all([a.nextState(), b.nextState()]);

    expect(server.getRoom('p2-room', '2p')?.getStatus()).toBe('playing');
    expect(stateA.turnNumber).toBe(0);
    expect(stateA.currentPlayerId).toBe('A');
    expect(stateA.board.cells).toHaveLength(32);
    expect(stateB).toEqual(stateA);
  });

  it('第三人加入 2P 房间被拒（roomClosed）', async () => {
    const server = await startServer({ mode, seatIds: ['A', 'B'], seed: 6, roomId: 'p2-full' });
    await join('p2-full');
    await join('p2-full');

    await expect(
      connectWebSocketGameSession({
        url: `ws://localhost:${serverPort}`,
        roomId: 'p2-full',
        mode: '2p',
      }),
    ).rejects.toThrow(/roomClosed/);
  });

  it('模式路由：同名 roomId 的 2P/3P 房间互不干扰', async () => {
    const server = await startServer({
      mode,
      seatIds: ['A', 'B'],
      extraModes: [
        { key: '2p', mode, seatIds: ['A', 'B'] },
        { key: '3p', mode: mode3p, seatIds: ['A', 'B', 'C'] },
      ],
      seed: 7,
      roomId: 'shared',
    });

    const p2 = await join('shared'); // mode=2p
    expect(p2.session.playerId).toBe('A');
    expect(server.getRoom('shared', '2p')?.getStatus()).toBe('waiting');

    // 3P 模式的同名房间：连接 3 个客户端应独立开局。
    const mode3pJoin = async () =>
      connectWebSocketGameSession({ url: `ws://localhost:${serverPort}`, roomId: 'shared', mode: '3p' });
    const t1 = await mode3pJoin();
    const t2 = await mode3pJoin();
    const t3 = await mode3pJoin();
    expect([t1.playerId, t2.playerId, t3.playerId]).toEqual(['A', 'B', 'C']);
    expect(server.getRoom('shared', '3p')?.getStatus()).toBe('playing');

    // 2P 房间未受影响：第二个 2P 客户端加入后 2P 房间开局。
    const p2b = await join('shared');
    expect(p2b.session.playerId).toBe('B');
    expect(server.getRoom('shared', '2p')?.getStatus()).toBe('playing');
  });
});

describe('联机 2P：对局与安全', () => {
  it('完整随机对局至终局：翻棋/移动/吃子/回合切换/胜负，双方状态逐步一致', async () => {
    const server = await startServer({ mode, seatIds: ['A', 'B'], seed: 88, roomId: 'p2-game' });

    const a = await join('p2-game');
    const b = await join('p2-game');
    const first = await Promise.all([a.nextState(), b.nextState()]);
    expect(first[1]).toEqual(first[0]);

    let state = a.session.getState()!;
    expect(state).toEqual(b.session.getState());

    const rng = mulberry32(20260912);
    const byId = new Map<string, ClientHarness>([
      ['A', a],
      ['B', b],
    ]);
    let turns = 0;

    while (state.status.kind === 'inProgress' && turns < 400) {
      const current = byId.get(state.currentPlayerId)!;
      const actions = engine.getLegalActions(state);
      expect(actions.length).toBeGreaterThan(0);
      const action = actions[rng.nextInt(actions.length)]! as GameAction;

      const pending = [a.nextState(), b.nextState()];
      current.session.submit({ playerId: current.session.playerId, action });
      const seen = [await pending[0], await pending[1]];

      state = seen[0]!;
      expect(seen[1]).toEqual(state);
      expect(state.turnNumber).toBe(turns + 1);
      turns += 1;
    }

    expect(turns).toBeGreaterThan(0);
    expect(state.status.kind).not.toBe('inProgress'); // 胜负或和棋正常终局
    expect(a.session.getState()).toEqual(state);
    expect(b.session.getState()).toEqual(state);
  }, 30000);

  it('非当前玩家操作被拒；伪造 playerId 信封无效', async () => {
    await startServer({ mode, seatIds: ['A', 'B'], seed: 9, roomId: 'p2-sec' });
    const a = await join('p2-sec');
    const b = await join('p2-sec');
    const first = await Promise.all([a.nextState(), b.nextState()]);
    expect(first[1]).toEqual(first[0]);

    // 非当前玩家 B 提交 → notCurrentPlayer
    b.session.submit({ playerId: 'B', action: reveal({ x: 0, y: 0 }) });
    await until(() => b.rejections.length > 0);
    expect(b.rejections[0]).toMatchObject({ code: 'notCurrentPlayer' });
    expect(a.session.getState()!.turnNumber).toBe(0);

    // B 伪造 playerId:'A' → 仍按连接身份 B 处理 → 拒绝
    b.session.submit({ playerId: 'A', action: reveal({ x: 0, y: 0 }) });
    await until(() => b.rejections.length > 1);
    expect(b.rejections[1]).toMatchObject({ code: 'notCurrentPlayer' });
    expect(a.session.getState()!.turnNumber).toBe(0);

    // A 合法翻棋 → 双方状态推进一致
    const pendingA = a.nextState();
    const pendingB2 = b.nextState();
    a.session.submit({ playerId: 'A', action: reveal({ x: 0, y: 0 }) });
    const [sa, sb] = await Promise.all([pendingA, pendingB2]);
    expect(sa).toEqual(sb);
    expect(sa.turnNumber).toBe(1);
    expect(sa.currentPlayerId).toBe('B');
  });

  it('超时判负：一方超时后对方立即获胜（最后活跃玩家）', async () => {
    const server = await startServer({
      mode,
      seatIds: ['A', 'B'],
      seed: 10,
      roomId: 'p2-timeout',
      turnTimeoutMs: 150,
    });
    const a = await join('p2-timeout');
    const b = await join('p2-timeout');
    await Promise.all([a.nextState(), b.nextState()]);

    await until(() => a.eliminations.some((e) => e.playerId === 'A' && e.reason === 'timeout'));
    await until(() => a.session.getState()?.status.kind === 'won', 4000);

    const finalStates = [a.session.getState()!, b.session.getState()!];
    expect(finalStates[0]!).toEqual(finalStates[1]!);
    // 超时发生在翻棋前：A 未绑定阵营 → 以玩家为判据获胜（winner 为 null）。
    expect(finalStates[0]!.status).toEqual({ kind: 'won', winner: null, winnerPlayerId: 'B' });
  });

  it('断线重连：令牌恢复原座位并收到最新权威状态', async () => {
    const server = await startServer({ mode, seatIds: ['A', 'B'], seed: 11, roomId: 'p2-rejoin' });
    const a = await join('p2-rejoin');
    const b = await join('p2-rejoin');
    await Promise.all([a.nextState(), b.nextState()]);
    const token = a.session.token;

    // A 行动一次后断线
    const pendingA2 = a.nextState();
    a.session.submit({ playerId: 'A', action: reveal({ x: 0, y: 0 }) });
    await pendingA2;
    a.session.close();

    const rejoined = await connectWebSocketGameSession({
      url: `ws://localhost:${serverPort}`,
      roomId: 'p2-rejoin',
      mode: '2p',
      token,
    });
    expect(rejoined.playerId).toBe('A');
    expect(rejoined.getState()).toEqual(b.session.getState());
    expect(rejoined.getState()!.turnNumber).toBe(1);
    expect(server.getRoom('p2-rejoin', '2p')?.getStatus()).toBe('playing');
    rejoined.close();
  });
});
