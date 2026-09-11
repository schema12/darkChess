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
    onTurnRemainingSec: (sec) => {
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

    // A 翻棋 → 新回合的广播把剩余时间重置为接近满额
    a.submit({ playerId: 'A', action: { kind: 'reveal', position: { x: 0, y: 0 } } });
    await until(() => b.remaining.latest! > 25, 2000);
    expect(b.remaining.latest!).toBeLessThanOrEqual(30);
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
      onTurnRemainingSec: (sec) => seen.push(sec),
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
