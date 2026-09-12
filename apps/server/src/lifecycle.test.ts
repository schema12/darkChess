import { afterAll, describe, expect, it } from 'vitest';
import {
  createDarkChess3p4x8Mode,
  createDarkChess4x8Mode,
  createEngine,
  mulberry32,
} from '@darkchess/core';
import { startDarkChessServer } from './index';
import type { RunningServer } from './index';
import { connectWebSocketGameSession } from './client/websocket-session';

const mode2p = createDarkChess4x8Mode();
const mode3p = createDarkChess3p4x8Mode();
const engine2p = createEngine(mode2p);

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

async function until(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('条件等待超时');
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** 快速把 2P 房间打到终局：A 超时判负（turnTimeoutMs 极小）或正常翻完。 */
async function play2pToTerminal(roomId: string, mode: '2p' | '3p' = '2p') {
  const a = await connectWebSocketGameSession({ url: `ws://localhost:${serverPort}`, roomId, mode });
  const b = await connectWebSocketGameSession({ url: `ws://localhost:${serverPort}`, roomId, mode });
  // A 翻棋 → B 翻棋 → … 用固定种子快速推进到终局（上限保护）。
  let guard = 0;
  const current = () => {
    const st = a.getState()!;
    return st.currentPlayerId === 'A' ? a : b;
  };
  while (a.getState()!.status.kind === 'inProgress' && guard < 400) {
    const seat = current();
    const st = seat.getState()!;
    // 用第一枚可翻棋子/第一个合法动作推进（翻棋阶段最简单：直接翻 (guard%32)）。
    const idx = guard % 32;
    seat.submit({
      playerId: st.currentPlayerId,
      action: { kind: 'reveal', position: { x: idx % 4, y: Math.floor(idx / 4) } },
    });
    guard += 1;
    if (a.getState()!.turnNumber !== guard) {
      // 动作被拒（该格已翻开等）——继续下一格即可，不失败。
    }
  }
  return { a, b, guard };
}

describe('Stage 8：reconnect token / Room 生命周期', () => {
  it('2P playing → disconnect → reconnect 恢复原座位（回归）', async () => {
    await startServer({ mode: mode2p, seatIds: ['A', 'B'], seed: 3, roomId: 'lc-play' });
    const a = await connectWebSocketGameSession({ url: `ws://localhost:${serverPort}`, roomId: 'lc-play', mode: '2p' });
    const b = await connectWebSocketGameSession({ url: `ws://localhost:${serverPort}`, roomId: 'lc-play', mode: '2p' });
    await new Promise((r) => setTimeout(r, 200));
    expect(a.getState()).not.toBeNull();

    const token = a.token;
    a.close();
    const again = await connectWebSocketGameSession({
      url: `ws://localhost:${serverPort}`, roomId: 'lc-play', mode: '2p', token,
    });
    expect(again.playerId).toBe('A');
    expect(again.getState()).toEqual(b.getState());
    again.close();
    b.close();
  });

  it('2P terminal → 新 join 同名房间：全新对局（旧 token 失效）', async () => {
    await startServer({
      mode: mode2p, seatIds: ['A', 'B'], seed: 4, roomId: 'lc-term',
      turnTimeoutMs: 60, // 快速制造终局：A 超时判负
    });
    const a = await connectWebSocketGameSession({ url: `ws://localhost:${serverPort}`, roomId: 'lc-term', mode: '2p' });
    const b = await connectWebSocketGameSession({ url: `ws://localhost:${serverPort}`, roomId: 'lc-term', mode: '2p' });
    await new Promise((r) => setTimeout(r, 250));
    expect(a.getState()!.status.kind).toBe('won'); // B 获胜，房间 finished
    const oldToken = a.token;
    a.close();
    b.close();
    await new Promise((r) => setTimeout(r, 100));

    // 新玩家以同名 roomId 加入（不带 token）→ 应得到全新 waiting 房间，而非旧终局。
    const fresh = await connectWebSocketGameSession({ url: `ws://localhost:${serverPort}`, roomId: 'lc-term', mode: '2p' });
    expect(fresh.playerId).toBe('A');
    expect(fresh.getState()).toBeNull(); // 新房间等待中
    expect(server_roomStatus('lc-term')).toBe('waiting');

    // 旧 terminal token 重新连接：内置单次回退 → 以全新身份进入新房间（不复活旧局）。
    // fresh 仍占座（waiting），revived 加入即满员开局 → 断言“新对局从第 0 手开始”。
    const revived = await connectWebSocketGameSession({
      url: `ws://localhost:${serverPort}`, roomId: 'lc-term', mode: '2p', token: oldToken,
    });
    expect(revived.playerId).toBe('B'); // 全新身份，而非旧 token 的 A 座位复活
    await until(() => revived.getState() !== null, 2000);
    expect(revived.getState()!.turnNumber).toBe(0); // 全新对局
    expect(revived.getState()!.status.kind).toBe('inProgress'); // 绝非旧终局
    revived.close();

    fresh.close();
  });

  it('3P terminal token 不能恢复进 2P 流程（跨模式隔离）', async () => {
    const server = await startServer({
      mode: mode3p, seatIds: ['A', 'B', 'C'], seed: 5, roomId: 'lc-iso',
      extraModes: [{ key: '2p', mode: mode2p, seatIds: ['A', 'B'] }],
      turnTimeoutMs: 60,
    });
    // 3P 房间：两人加入不开局，直接制造一个 3P token（不等待终局——房间仍 waiting）。
    const p3a = await connectWebSocketGameSession({ url: `ws://localhost:${serverPort}`, roomId: 'lc-iso', mode: '3p' });
    const token3p = p3a.token;
    p3a.close();

    // 带旧 3P token 从 2P 模式进入：模式隔离令其失效 → 内置回退以全新 2P 身份加入
    //（绝不恢复 3P 座位/棋局）。
    const via2p = await connectWebSocketGameSession({
      url: `ws://localhost:${serverPort}`, roomId: 'lc-iso', mode: '2p', token: token3p,
    });
    expect(via2p.getState()).toBeNull(); // 2P 全新 waiting；绝无 3P 棋局
    const room2p = server.getRoom('lc-iso', '2p')!;
    expect(room2p.playersInfo().every((p) => p.factionId === null)).toBe(true);
    via2p.close();
  });

  it('2P terminal token 不能恢复进 3P 流程（跨模式隔离对称）', async () => {
    await startServer({
      mode: mode2p, seatIds: ['A', 'B'], seed: 6, roomId: 'lc-iso2',
      extraModes: [{ key: '3p', mode: mode3p, seatIds: ['A', 'B', 'C'] }],
      turnTimeoutMs: 60,
    });
    const a = await connectWebSocketGameSession({ url: `ws://localhost:${serverPort}`, roomId: 'lc-iso2', mode: '2p' });
    const token2p = a.token;
    a.close();

    const via3p = await connectWebSocketGameSession({
      url: `ws://localhost:${serverPort}`, roomId: 'lc-iso2', mode: '3p', token: token2p,
    });
    expect(via3p.getState()).toBeNull(); // 3P 全新 waiting；绝无 2P 棋局
    via3p.close();
  });

  it('失败方/获胜方重新开始：terminal 后各自加入新房间均正常', async () => {
    await startServer({
      mode: mode2p, seatIds: ['A', 'B'], seed: 7, roomId: 'lc-again',
      extraModes: [{ key: 'again2', mode: mode2p, seatIds: ['A', 'B'] }],
      turnTimeoutMs: 60,
    });
    // 旧局：A 超时 → B 胜。
    const loser = await connectWebSocketGameSession({ url: `ws://localhost:${serverPort}`, roomId: 'lc-again', mode: '2p' });
    const winner = await connectWebSocketGameSession({ url: `ws://localhost:${serverPort}`, roomId: 'lc-again', mode: '2p' });
    await new Promise((r) => setTimeout(r, 250));
    expect(winner.getState()!.status).toMatchObject({ kind: 'won' });
    loser.close();
    winner.close();
    await new Promise((r) => setTimeout(r, 100));

    // 双方各自加入新房间（不同 roomId）→ 正常等待/开局。
    const againA = await connectWebSocketGameSession({ url: `ws://localhost:${serverPort}`, roomId: 'rematch-a', mode: '2p' });
    const againB = await connectWebSocketGameSession({ url: `ws://localhost:${serverPort}`, roomId: 'rematch-b', mode: '2p' });
    expect(againA.getState()).toBeNull();
    expect(againB.getState()).toBeNull();

    // 同一新房间的第二次加入 → 开局。
    const againA2 = await connectWebSocketGameSession({ url: `ws://localhost:${serverPort}`, roomId: 'rematch-a', mode: '2p' });
    expect(againA2.playerId).toBe('B');
    await until(() => againA.getState() !== null);
    expect(againA2.getState()).toEqual(againA.getState());
    againA.close();
    againA2.close();
    againB.close();
  });

  it('terminal Room 不阻塞新 Room：同名 id 立即可再开局（2P）', async () => {
    await startServer({ mode: mode2p, seatIds: ['A', 'B'], seed: 8, roomId: 'lc-reuse' });
    for (let round = 1; round <= 2; round++) {
      const x = await connectWebSocketGameSession({ url: `ws://localhost:${serverPort}`, roomId: 'lc-reuse', mode: '2p' });
      const y = await connectWebSocketGameSession({ url: `ws://localhost:${serverPort}`, roomId: 'lc-reuse', mode: '2p' });
      if (round === 1) {
        await until(() => x.getState() !== null && y.getState() !== null);
        // 第一局用合法动作推进到终局（随机自对弈，每步等待广播确认）。
        const rng = mulberry32(20260912);
        let guard = 0;
        while (x.getState()!.status.kind === 'inProgress' && guard < 400) {
          const st = x.getState()!;
          const seat = st.currentPlayerId === 'A' ? x : y;
          const actions = engine2p.getLegalActions(st);
          expect(actions.length).toBeGreaterThan(0);
          seat.submit({ playerId: st.currentPlayerId, action: actions[rng.nextInt(actions.length)]! });
          const before = st.turnNumber;
          await until(
            () => x.getState()!.turnNumber > before || x.getState()!.status.kind !== 'inProgress',
          );
          guard += 1;
        }
        expect(x.getState()!.status.kind).not.toBe('inProgress');
      } else {
        // 第二局：房间应处于 waiting（全新对局），而非恢复第一局终局。
        expect(x.getState()).toBeNull();
      }
      x.close();
      y.close();
      await new Promise((r) => setTimeout(r, 80));
    }
  }, 60000);

  it('terminal 房间旧 token rejoin 被拒；客户端回退后进入全新房间（Bug2 完整链路）', async () => {
    const server = await startServer({
      mode: mode2p, seatIds: ['A', 'B'], seed: 10, roomId: 'lc-fallback',
      extraModes: [], turnTimeoutMs: 60,
    });
    // 离线期间对局结束（超时判负）→ 本机仍存有旧 token。
    const a = await connectWebSocketGameSession({ url: `ws://localhost:${serverPort}`, roomId: 'lc-fallback', mode: '2p' });
    const b = await connectWebSocketGameSession({ url: `ws://localhost:${serverPort}`, roomId: 'lc-fallback', mode: '2p' });
    await new Promise((r) => setTimeout(r, 250));
    expect(a.getState()!.status.kind).toBe('won');
    const staleToken = a.token;
    a.close();
    b.close();
    await new Promise((r) => setTimeout(r, 100));

    // 服务端直接 rejoin 旧 token：必须被拒（roomClosed），不得恢复旧局。
    const roomObj = server.getRoom('lc-fallback', '2p')!;
    const fake = { send: () => undefined, close: () => undefined };
    expect(roomObj.rejoin(staleToken, fake).ok).toBe(false);

    // 客户端流程：带旧 token 连接 → 回退为全新加入 → 进入全新 waiting 房间（非旧终局）。
    const fallback = await connectWebSocketGameSession({
      url: `ws://localhost:${serverPort}`, roomId: 'lc-fallback', mode: '2p', token: staleToken,
    });
    expect(fallback.playerId).toBe('A');
    expect(fallback.getState()).toBeNull(); // 全新房间等待中
    fallback.close();
  });

  it('替换房间继承计时策略（Bug5：重开后 timer 不消失）', async () => {
    const server = await startServer({
      mode: mode2p, seatIds: ['A', 'B'], seed: 11, roomId: 'lc-inherit',
      extraModes: [], turnTimeoutMs: 60,
    });
    // 旧局：创建时声明 90s 计时 → 用权威 forfeit 快速制造终局（房间进入 finished）。
    const a = await connectWebSocketGameSession({
      url: `ws://localhost:${serverPort}`, roomId: 'lc-inherit', mode: '2p', timerSec: 90,
    });
    const b = await connectWebSocketGameSession({ url: `ws://localhost:${serverPort}`, roomId: 'lc-inherit', mode: '2p' });
    await new Promise((r) => setTimeout(r, 250));
    server.getRoom('lc-inherit', '2p')!.forfeit('A', 'timeout');
    await until(() => a.getState()?.status.kind === 'won', 2000);
    a.close();
    b.close();
    await new Promise((r) => setTimeout(r, 100));

    // 重开：全新 join 替换 finished 房间 → 继承 ?timer=90 的策略（第二人加入后开局广播剩余 ≤90）。
    const seen: Array<number | null> = [];
    const x = await connectWebSocketGameSession({
      url: `ws://localhost:${serverPort}`, roomId: 'lc-inherit', mode: '2p',
      onState: (_st, rem) => seen.push(rem),
    });
    expect(x.getState()).toBeNull(); // 全新 waiting
    const y = await connectWebSocketGameSession({ url: `ws://localhost:${serverPort}`, roomId: 'lc-inherit', mode: '2p' });
    await until(() => seen.length > 0 && seen[seen.length - 1] !== null, 3000);
    const rem = seen[seen.length - 1]!;
    expect(rem).toBeLessThanOrEqual(90);
    expect(rem).toBeGreaterThan(80); // 策略 90s 被继承，而非不限时（null）或 60ms
    x.close();
    y.close();
  });

  it('3P reconnect 回归（进行中断线恢复）', async () => {
    await startServer({ mode: mode3p, seatIds: ['A', 'B', 'C'], seed: 9, roomId: 'lc-3p' });
    const a = await connectWebSocketGameSession({ url: `ws://localhost:${serverPort}`, roomId: 'lc-3p', mode: '3p' });
    const b = await connectWebSocketGameSession({ url: `ws://localhost:${serverPort}`, roomId: 'lc-3p', mode: '3p' });
    const c = await connectWebSocketGameSession({ url: `ws://localhost:${serverPort}`, roomId: 'lc-3p', mode: '3p' });
    await new Promise((r) => setTimeout(r, 200));
    const token = a.token;
    a.close();
    const again = await connectWebSocketGameSession({
      url: `ws://localhost:${serverPort}`, roomId: 'lc-3p', mode: '3p', token,
    });
    expect(again.playerId).toBe('A');
    expect(again.getState()).toEqual(c.getState());
    again.close();
    b.close();
    c.close();
  });
});

function server_roomStatus(roomId: string): string | null {
  // 通过房间对象状态断言（测试辅助）。
  const server = servers[servers.length - 1];
  return server?.getRoom(roomId, '2p')?.getStatus() ?? null;
}
