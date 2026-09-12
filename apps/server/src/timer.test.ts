import { afterAll, describe, expect, it } from 'vitest';
import { createDarkChess4x8Mode } from '@darkchess/core';
import { startDarkChessServer } from './index';
import type { RunningServer } from './index';
import { connectWebSocketGameSession } from './client/websocket-session';
import type { WebSocketGameSession } from './client/websocket-session';

const mode = createDarkChess4x8Mode();

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

interface Harness {
  session: WebSocketGameSession;
  remaining: { seen: Array<number | null>; latest: number | null };
  eliminations: Array<{ playerId: string; reason: string }>;
  readonly token: string;
  getState(): ReturnType<WebSocketGameSession['getState']>;
  submit: WebSocketGameSession['submit'];
  close(): void;
}

async function join(roomId: string, timerSec?: number): Promise<Harness> {
  const remaining: Harness['remaining'] = { seen: [], latest: null };
  const eliminations: Harness['eliminations'] = [];
  const session = await connectWebSocketGameSession({
    url: `ws://localhost:${serverPort}`,
    roomId,
    mode: '2p',
    timerSec,
    onState: (_state, sec) => {
      remaining.seen.push(sec);
      remaining.latest = sec;
    },
    onEliminated: (e) => eliminations.push(e),
  });
  return {
    session,
    remaining,
    eliminations,
    token: session.token,
    getState: () => session.getState(),
    submit: session.submit,
    close: () => session.close(),
  };
}

async function until(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('条件等待超时');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('Stage 9：好友房计时策略（服务端权威）', () => {
  it('不限时房间：广播不携带剩余时间（null）', async () => {
    await startServer({ mode, seatIds: ['A', 'B'], seed: 1, roomId: 't-off' });
    const a = await join('t-off');
    const b = await join('t-off');
    await new Promise((r) => setTimeout(r, 200));

    expect(a.remaining.latest).toBeNull();
    expect(b.remaining.latest).toBeNull();
    expect(a.getState()!.status.kind).toBe('inProgress'); // 开局正常
    a.close();
    b.close();
  });

  it('计时房间：开局广播携带剩余秒数；行动后重置为满额', async () => {
    await startServer({ mode, seatIds: ['A', 'B'], seed: 2, roomId: 't-on' });
    const a = await join('t-on', 30);
    const b = await join('t-on'); // 后加入者不带 timer → 沿用房间既有策略
    await until(() => a.remaining.latest !== null, 2000);
    await until(() => b.remaining.latest !== null, 2000);

    expect(a.remaining.latest!).toBeLessThanOrEqual(30);
    expect(a.remaining.latest!).toBeGreaterThan(25); // 刚开局，接近满额

    // A 翻棋 → 新回合的广播把剩余时间重置为接近满额。
    // 关键回归点：相邻两回合的剩余秒数相同（30→30）也必须各自广播（Bug1 服务器侧锚点）。
    const firstTurnRemaining = a.remaining.latest!;
    a.submit({ playerId: 'A', action: { kind: 'reveal', position: { x: 0, y: 0 } } });
    await until(() => b.remaining.seen.length >= 2, 2000);
    // B 的广播流中至少两条、且第二条（新回合）与第一条同值或接近满额——都不是旧回合残留
    expect(b.remaining.seen[0]).toBeLessThanOrEqual(30);
    expect(b.remaining.latest!).toBeGreaterThan(25);
    expect(b.remaining.latest!).toBeLessThanOrEqual(30);
    void firstTurnRemaining;
    a.close();
    b.close();
  });

  it('服务端超时判负：时间耗尽 → 当前玩家被淘汰 → 对方以玩家判据获胜', async () => {
    await startServer({ mode, seatIds: ['A', 'B'], seed: 3, roomId: 't-timeout', turnTimeoutMs: 300 });
    const a = await join('t-timeout', 5); // 创建者声明 5 秒（桥接最小钳制 5s）
    const b = await join('t-timeout');
    await until(() => a.remaining.latest !== null, 2000);

    await until(() => a.getState()?.status.kind === 'won', 8000);
    expect(a.getState()!.status).toEqual({ kind: 'won', winner: null, winnerPlayerId: 'B' });
    expect(a.eliminations.some((e) => e.playerId === 'A' && e.reason === 'timeout')).toBe(true);
    // 终局广播的剩余时间为 null（计时已拆除）
    expect(a.remaining.latest).toBeNull();
    a.close();
    b.close();
  }, 15000);

  it('陈旧连接关闭不破坏重连后的座位（Bug3：close 竞态不得 clobber 新会话）', async () => {
    const server = await startServer({ mode, seatIds: ['A', 'B'], seed: 5, roomId: 't-stale' });
    const a = await join('t-stale');
    const b = await join('t-stale');
    await until(() => a.getState() !== null && b.getState() !== null, 2000);
    const token = a.token;

    // 先用令牌建立第二条连接（座位重绑到新连接），再关闭第一条（陈旧）连接。
    const a2 = await connectWebSocketGameSession({
      url: `ws://localhost:${serverPort}`,
      roomId: 't-stale',
      mode: '2p',
      token,
    });
    expect(a2.playerId).toBe('A');
    a.close(); // 陈旧连接的 close 事件随后到达
    await new Promise((r) => setTimeout(r, 200));

    // 座位 A 必须仍然在线（陈旧 close 不得覆盖新连接），且能继续收到广播。
    const seatA = server.getRoom('t-stale', '2p')!.playersInfo().find((p) => p.playerId === 'A');
    expect(seatA?.connected).toBe(true);
    const before = b.getState()!.turnNumber;
    a2.submit({ playerId: 'A', action: { kind: 'reveal', position: { x: 1, y: 0 } } });
    await until(() => (b.getState()?.turnNumber ?? 0) > before, 2000);
    a2.close();
    b.close();
  });

  it('重连后收到正确的剩余时间（计时继续由服务器控制，不因断线清除）', async () => {
    await startServer({ mode, seatIds: ['A', 'B'], seed: 4, roomId: 't-rejoin', turnTimeoutMs: 30000 });
    const a = await join('t-rejoin', 30);
    const b = await join('t-rejoin');
    await until(() => a.remaining.latest !== null, 2000);
    const token = a.token;
    a.close();

    const seen: Array<number | null> = [];
    const rejoined = await connectWebSocketGameSession({
      url: `ws://localhost:${serverPort}`,
      roomId: 't-rejoin',
      mode: '2p',
      token,
      onState: (_state, sec) => seen.push(sec),
    });
    expect(rejoined.playerId).toBe('A');
    await until(() => seen.length > 0 && seen[seen.length - 1] !== null);
    const rem = seen[seen.length - 1]!;
    expect(rem).toBeLessThanOrEqual(30);
    expect(rem).toBeGreaterThan(0);
    expect(rejoined.getState()).toEqual(b.getState());
    rejoined.close();
    b.close();
  });
});
