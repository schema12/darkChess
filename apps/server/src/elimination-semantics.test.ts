import { afterAll, describe, expect, it } from 'vitest';
import {
  createDarkChess3p4x8Mode,
  createDarkChess4x8Mode,
  createEngine,
  mulberry32,
} from '@darkchess/core';
import type { GameAction, GameState } from '@darkchess/core';
import { startDarkChessServer } from './index';
import type { RunningServer } from './index';
import { connectWebSocketGameSession } from './client/websocket-session';
import type { WebSocketGameSession } from './client/websocket-session';

const mode2p = createDarkChess4x8Mode();
const mode3p = createDarkChess3p4x8Mode();

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
  eliminations: Array<{ playerId: string; reason: string }>;
  remaining: { seen: Array<number | null>; latest: number | null };
  states: GameState[];
  token: string;
  playerId: string;
  getState(): GameState | null;
  submit: WebSocketGameSession['submit'];
  close(): void;
}

async function join(roomId: string, mode: '2p' | '3p', timerSec?: number): Promise<Harness> {
  const eliminations: Harness['eliminations'] = [];
  const remaining: Harness['remaining'] = { seen: [], latest: null };
  const states: GameState[] = [];
  const session = await connectWebSocketGameSession({
    url: `ws://localhost:${serverPort}`,
    roomId,
    mode,
    timerSec,
    onState: (s, rem) => {
      states.push(s);
      remaining.seen.push(rem);
      remaining.latest = rem;
    },
    onEliminated: (e) => eliminations.push(e),
  });
  return {
    session,
    eliminations,
    remaining,
    states,
    token: session.token,
    playerId: session.playerId,
    getState: () => session.getState(),
    submit: session.submit,
    close: () => session.close(),
  };
}

async function until(predicate: () => boolean, timeoutMs = 6000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('条件等待超时');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('v1.0.2.1：timeout / noLegalAction 语义互斥（P0-1）', () => {
  it('Case 1+4：2P A 超时 → 恰好一条 timeout 淘汰事件；B 回合广播满额计时', async () => {
    await startServer({ mode: mode2p, seatIds: ['A', 'B'], seed: 1, roomId: 'es-2p', turnTimeoutMs: 5_000 });
    const a = await join('es-2p', '2p');
    const b = await join('es-2p', '2p');
    await until(() => a.getState() !== null, 2000);

    await until(() => a.getState()?.status.kind === 'won', 20000);

    // 互斥锚点：eliminated 事件广播给所有座位——按“目标玩家”过滤断言。
    const aEvents = a.eliminations.filter((e) => e.playerId === 'A');
    expect(aEvents).toHaveLength(1); // 目标玩家 A 恰好一条（排重）
    expect(aEvents[0]!.reason).toBe('timeout');
    expect(a.eliminations.some((e) => e.playerId === 'A' && e.reason === 'noLegalAction')).toBe(false);
    // B 从未成为淘汰目标。
    expect(a.eliminations.some((e) => e.playerId === 'B')).toBe(false);
    // 开局广播满额计时；2P 超时 → B 直接获胜，终局广播 remaining=null（计时拆除）。
    expect(a.remaining.seen[0]).toBe(5);
    expect(a.remaining.latest).toBeNull();
    // 终局语义：overlay 条件 = status won（仅剩一名未淘汰玩家）。
    expect(a.getState()!.status).toEqual({ kind: 'won', winner: null, winnerPlayerId: 'B' });
    a.close();
    b.close();
  }, 30000);

  it('Case 2+6：3P A 超时 → 仅 timeout 信息；对局继续，不弹 Game Over', async () => {
    await startServer({
      mode: mode3p, seatIds: ['A', 'B', 'C'], seed: 2, roomId: 'es-3p', turnTimeoutMs: 5_000,
    });
    const a = await join('es-3p', '3p');
    const b = await join('es-3p', '3p');
    const c = await join('es-3p', '3p');
    await until(() => a.getState() !== null, 2000);

    await until(() => a.eliminations.some((e) => e.playerId === 'A'), 20000);

    const aEvents = a.eliminations.filter((e) => e.playerId === 'A');
    expect(aEvents).toHaveLength(1);
    expect(aEvents[0]!.reason).toBe('timeout');
    expect(a.eliminations.some((e) => e.playerId === 'A' && e.reason === 'noLegalAction')).toBe(false);
    // B/C 从未成为淘汰目标。
    expect(a.eliminations.some((e) => e.playerId === 'B')).toBe(false);
    expect(a.eliminations.some((e) => e.playerId === 'C')).toBe(false);
    // 单人淘汰 ≠ Game Over：状态仍进行中，B 的回合广播满额计时。
    expect(a.getState()!.status.kind).toBe('inProgress');
    expect(a.getState()!.currentPlayerId).toBe('B');
    expect(a.remaining.latest).toBe(5);
    expect(b.remaining.latest).toBe(5);
    a.close();
    b.close();
    c.close();
  }, 30000);

  it('Case 7：3P A/B 相继超时 → C 获胜；每名玩家恰一条 timeout 事件', async () => {
    await startServer({
      mode: mode3p, seatIds: ['A', 'B', 'C'], seed: 3, roomId: 'es-chain', turnTimeoutMs: 5_000,
    });
    const a = await join('es-chain', '3p');
    const b = await join('es-chain', '3p');
    const c = await join('es-chain', '3p');
    await until(() => a.getState() !== null, 2000);

    await until(() => a.getState()?.status.kind === 'won', 30000);

    expect(a.eliminations.filter((e) => e.playerId === 'A')).toHaveLength(1);
    expect(b.eliminations.filter((e) => e.playerId === 'B')).toHaveLength(1);
    expect(a.eliminations.filter((e) => e.playerId === 'A').every((e) => e.reason === 'timeout')).toBe(true);
    expect(b.eliminations.filter((e) => e.playerId === 'B').every((e) => e.reason === 'timeout')).toBe(true);
    expect(a.eliminations.some((e) => e.playerId === 'C')).toBe(false);
    expect(a.getState()!.status).toEqual({ kind: 'won', winner: null, winnerPlayerId: 'C' });
    a.close();
    b.close();
    c.close();
  }, 60000);

  it('Case 3：无合法行动淘汰 → reason 恒为 noLegalAction 且每玩家恰一条；不限时房绝不产生 timeout', async () => {
    await startServer({ mode: mode3p, seatIds: ['A', 'B', 'C'], seed: 4, roomId: 'es-nola' });
    const engine = createEngine(mode3p);
    let observed = false;

    // 随机自对弈：不限时房中任何淘汰事件的原因必为 noLegalAction（无 timeout 路径）。
    for (let seed = 1; seed <= 12 && !observed; seed++) {
      const h = await Promise.all([
        join(`nola-${seed}`, '3p'),
        join(`nola-${seed}`, '3p'),
        join(`nola-${seed}`, '3p'),
      ]);
      let state: GameState = await new Promise<GameState>((r) => {
        const existing = h[2].states[0];
        if (existing) r(existing);
        else h[2].session.subscribe((x) => r(x));
      });
      const byId = new Map(h.map((x) => [x.playerId, x] as const));
      const rng = mulberry32(seed * 7919);
      let turns = 0;
      while (state.status.kind === 'inProgress' && turns < 400) {
        const seat = byId.get(state.currentPlayerId)!;
        const actions = engine.getLegalActions(state);
        expect(actions.length).toBeGreaterThan(0);
        const action = actions[rng.nextInt(actions.length)]! as GameAction;
        const pending = h.map((x) => new Promise<GameState>((r) => {
          const unsub = x.session.subscribe((s2) => { unsub(); r(s2); });
        }));
        seat.submit({ playerId: seat.playerId, action });
        const got = await Promise.all(pending);
        state = got[0]!;
        for (const x of got) expect(x).toEqual(state);
        turns += 1;

        // eliminated 事件广播给所有座位：以任一连接的事件流为准（三个连接必须一致）。
        const stream = h[0].eliminations;
        if (stream.length > 0) {
          observed = true;
          expect(h[1].eliminations).toEqual(stream);
          expect(h[2].eliminations).toEqual(stream);
          // 不限时房：原因必为 noLegalAction，且每名目标玩家恰好一条事件（服务器排重）。
          expect(stream.every((e) => e.reason === 'noLegalAction')).toBe(true);
          const counts = new Map<string, number>();
          for (const e of stream) counts.set(e.playerId, (counts.get(e.playerId) ?? 0) + 1);
          for (const n of counts.values()) expect(n).toBe(1);
          break;
        }
      }
      for (const x of h) x.close();
    }
    expect(observed).toBe(true);
  }, 400000);
});
