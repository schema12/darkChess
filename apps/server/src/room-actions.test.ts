import { afterAll, describe, expect, it } from 'vitest';
import {
  createDarkChess3p4x8Mode,
  createDarkChess4x8Mode,
} from '@darkchess/core';
import type { GameAction } from '@darkchess/core';
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
  rejections: Array<{ code: string; reason: string }>;
  eliminations: Array<{ playerId: string; reason: string }>;
  drawOffers: Array<{ fromPlayerId: string; count: number; max: number }>;
  drawResponses: Array<{ fromPlayerId: string; accept: boolean; resolved: boolean }>;
  token: string;
  playerId: string;
  getState(): ReturnType<WebSocketGameSession['getState']>;
  submit(action: GameAction): void;
  resign(): void;
  drawOffer(): void;
  drawResponse(accept: boolean): void;
  rematchReady(): void;
  close(): void;
}

async function join(roomId: string, mode: '2p' | '3p', timerSec?: number): Promise<Harness> {
  const rejections: Harness['rejections'] = [];
  const eliminations: Harness['eliminations'] = [];
  const drawOffers: Harness['drawOffers'] = [];
  const drawResponses: Harness['drawResponses'] = [];
  const session = await connectWebSocketGameSession({
    url: `ws://localhost:${serverPort}`,
    roomId,
    mode,
    onState: () => undefined,
    onEliminated: (e) => eliminations.push(e),
    onRejected: (r) => rejections.push(r),
    onDrawOffer: (e) => drawOffers.push(e),
    onDrawResponse: (e) => drawResponses.push(e),
  });
  return {
    session,
    rejections,
    eliminations,
    drawOffers,
    drawResponses,
    token: session.token,
    playerId: session.playerId,
    getState: () => session.getState(),
    submit: (action) => session.submit({ playerId: session.playerId, action }),
    resign: () => session.resign(),
    drawOffer: () => session.drawOffer(),
    drawResponse: (accept) => session.drawResponse(accept),
    rematchReady: () => session.rematchReady(),
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

async function untilStarted(...harnesses: Harness[]): Promise<void> {
  await until(() => harnesses.every((h) => h.getState() !== null), 3000);
}

describe('v1.0.3：认输（resign）', () => {
  it('2P：A 认输 → reason=resign 恰一条 → B 立即获胜', async () => {
    await startServer({ mode: mode2p, seatIds: ['A', 'B'], seed: 1, roomId: 'rs-2p' });
    const a = await join('rs-2p', '2p');
    const b = await join('rs-2p', '2p');
    await untilStarted(a, b);

    a.resign();
    await until(() => a.getState()?.status.kind === 'won', 3000);

    const aEvents = a.eliminations.filter((e) => e.playerId === 'A');
    expect(aEvents).toHaveLength(1);
    expect(aEvents[0]!.reason).toBe('resign');
    expect(a.getState()!.status).toEqual({ kind: 'won', winner: null, winnerPlayerId: 'B' });
    a.close();
    b.close();
  });

  it('3P：A 认输 → B/C 继续（不弹 Game Over）', async () => {
    await startServer({ mode: mode3p, seatIds: ['A', 'B', 'C'], seed: 2, roomId: 'rs-3p' });
    const a = await join('rs-3p', '3p');
    const b = await join('rs-3p', '3p');
    const c = await join('rs-3p', '3p');
    await untilStarted(a, b, c);

    a.resign();
    await until(() => a.eliminations.some((e) => e.playerId === 'A'), 3000);

    expect(a.eliminations.filter((e) => e.playerId === 'A')).toHaveLength(1);
    expect(a.eliminations[0]!.reason).toBe('resign');
    expect(a.getState()!.status.kind).toBe('inProgress'); // 游戏继续
    a.close();
    b.close();
    c.close();
  });
});

describe('v1.0.3：求和（draw offer）', () => {
  it('2P：A 提议 → B 拒绝 → 继续（次数消耗 1）；再提议 → B 同意 → 和棋', async () => {
    await startServer({ mode: mode2p, seatIds: ['A', 'B'], seed: 3, roomId: 'dr-1' });
    const a = await join('dr-1', '2p');
    const b = await join('dr-1', '2p');
    await untilStarted(a, b);

    // 第 1 次：提议 → B 收到（count 1/3）→ B 拒绝 → 提议终结（resolved）→ 继续
    a.drawOffer();
    await until(() => b.drawOffers.length === 1, 2000);
    expect(b.drawOffers[0]).toMatchObject({ fromPlayerId: 'A', count: 1, max: 3 });
    b.drawResponse(false);
    await until(() => a.drawResponses.length === 1, 2000);
    expect(a.drawResponses[0]!).toMatchObject({ fromPlayerId: 'B', accept: false, resolved: true });
    expect(a.getState()!.status.kind).toBe('inProgress');

    // 第 2 次：reject 后再次发起正常 → B 同意 → 权威和棋（agreement）
    a.drawOffer();
    await until(() => b.drawOffers.length === 2, 2000);
    expect(b.drawOffers[1]!.count).toBe(2); // 拒绝同样消耗
    b.drawResponse(true);
    await until(() => a.getState()?.status.kind === 'drawn', 3000);
    expect(a.drawResponses[1]!).toMatchObject({ fromPlayerId: 'B', accept: true, resolved: true });
    expect(a.getState()!.status).toEqual({ kind: 'drawn', reason: { kind: 'agreement' } });
    a.close();
    b.close();
  });

  it('求和次数 3/3：连续发起 3 次后第 4 次被拒（drawLimit）', async () => {
    await startServer({ mode: mode2p, seatIds: ['A', 'B'], seed: 4, roomId: 'dr-2' });
    const a = await join('dr-2', '2p');
    const b = await join('dr-2', '2p');
    await untilStarted(a, b);

    for (let i = 1; i <= 3; i++) {
      a.drawOffer();
      await until(() => a.drawOffers.length === i, 2000);
      expect(a.drawOffers[i - 1]!.count).toBe(i);
      b.drawResponse(false); // 拒绝也消耗
      await until(() => a.drawResponses.length === i, 2000);
    }

    a.drawOffer();
    await until(() => a.rejections.some((r) => r.code === 'drawLimit'), 2000);
    expect(a.drawOffers.length).toBe(3); // 第 4 次未广播
    a.close();
    b.close();
  });

  it('3P：A 提议 → B 同意、C 拒绝 → 继续；再次提议全员同意 → 和棋', async () => {
    await startServer({ mode: mode3p, seatIds: ['A', 'B', 'C'], seed: 5, roomId: 'dr-3p' });
    const a = await join('dr-3p', '3p');
    const b = await join('dr-3p', '3p');
    const c = await join('dr-3p', '3p');
    await untilStarted(a, b, c);

    // 第一轮：C 拒绝 → 继续
    a.drawOffer();
    await until(() => b.drawOffers.length === 1 && c.drawOffers.length === 1, 2000);
    b.drawResponse(true);
    c.drawResponse(false);
    await until(() => a.drawResponses.length === 2, 2000);
    expect(a.getState()!.status.kind).toBe('inProgress');

    // 第二轮：B/C 都同意 → 和棋
    a.drawOffer();
    await until(() => b.drawOffers.length === 2 && c.drawOffers.length === 2, 2000);
    b.drawResponse(true);
    c.drawResponse(true);
    await until(() => a.getState()?.status.kind === 'drawn', 3000);
    expect(a.getState()!.status).toEqual({ kind: 'drawn', reason: { kind: 'agreement' } });
    a.close();
    b.close();
    c.close();
  });

  it('3P：求和等待期回应者被淘汰 → 提议作废（accept=false 广播），对局继续', async () => {
    const server = await startServer({ mode: mode3p, seatIds: ['A', 'B', 'C'], seed: 6, roomId: 'dr-cancel' });
    const a = await join('dr-cancel', '3p');
    const b = await join('dr-cancel', '3p');
    const c = await join('dr-cancel', '3p');
    await untilStarted(a, b, c);

    // A（当前行动）发起求和 → 待回应 [B, C]
    a.drawOffer();
    await until(() => b.drawOffers.length === 1 && c.drawOffers.length === 1, 2000);

    // 直接权威淘汰回应者 B（A/C 仍存活 → 游戏继续）→ 待回应含 B → 提议作废
    server.getRoom('dr-cancel', '3p')!.forfeit('B', 'timeout');
    await until(() => a.drawResponses.length === 1, 3000);
    expect(a.drawResponses[0]!.accept).toBe(false);

    // 对局继续：A/C 存活，状态进行中
    expect(a.getState()!.status.kind).toBe('inProgress');
    a.close();
    b.close();
    c.close();
  });
});

describe('v1.0.3.2：回合限制（认输/求和仅当前行动玩家）', () => {
  it('B 非当前行动：drawOffer 与 resign 均被权威拒绝（notCurrentPlayer）', async () => {
    await startServer({ mode: mode2p, seatIds: ['A', 'B'], seed: 20, roomId: 'tr-1' });
    const a = await join('tr-1', '2p');
    const b = await join('tr-1', '2p');
    await untilStarted(a, b); // A 当前行动

    b.drawOffer();
    await until(() => b.rejections.some((r) => r.code === 'notCurrentPlayer'), 2000);
    b.resign();
    await until(() => b.rejections.filter((r) => r.code === 'notCurrentPlayer').length === 2, 2000);

    // 对局未受影响：A 仍可正常行动
    a.submit(reveal({ x: 0, y: 0 }));
    await until(() => a.getState()?.turnNumber === 1, 2000);
    expect(a.getState()!.status.kind).toBe('inProgress');
    a.close();
    b.close();
  });

  it('A 当前行动：drawOffer 与 resign 均被允许', async () => {
    await startServer({ mode: mode2p, seatIds: ['A', 'B'], seed: 21, roomId: 'tr-2' });
    const a = await join('tr-2', '2p');
    const b = await join('tr-2', '2p');
    await untilStarted(a, b); // A 当前行动

    a.drawOffer();
    await until(() => b.drawOffers.length === 1, 2000); // 提议广播给 B（接收链路）
    b.drawResponse(true); // 非当前行动玩家可以响应
    await until(() => a.getState()?.status.kind === 'drawn', 3000);
    expect(a.getState()!.status).toEqual({ kind: 'drawn', reason: { kind: 'agreement' } });
    a.close();
    b.close();
  });
});

describe('v1.0.3：再来一局（rematch ready）', () => {
  it('2P 终局 → A 准备/B 未准备 → 不开局；terminal 期间动作被拒；B 准备 → 全新对局', async () => {
    const server = await startServer({ mode: mode2p, seatIds: ['A', 'B'], seed: 7, roomId: 'rm-1' });
    const a = await join('rm-1', '2p');
    const b = await join('rm-1', '2p');
    await untilStarted(a, b);

    a.submit(reveal({ x: 0, y: 0 })); // 先走一步，使旧局 turnNumber > 0
    await until(() => a.getState()?.turnNumber === 1, 2000);
    // A 走棋后轮到 B；B 在自己的回合认输（当前行动 ✓）→ A 获胜
    b.resign();
    await until(() => a.getState()?.status.kind === 'won', 3000);
    const finalTurn = a.getState()!.turnNumber;
    expect(finalTurn).toBeGreaterThan(0);

    a.rematchReady();
    await until(() => server.getRoom('rm-1', '2p')!.rematchReadyPlayers().includes('A'), 2000);
    expect(server.getRoom('rm-1', '2p')!.rematchReadyPlayers()).toEqual(['A']);
    expect(a.getState()!.status.kind).toBe('won'); // B 未准备 → 不开局

    // terminal 期间旧局操作被禁止
    b.submit(reveal({ x: 0, y: 0 }));
    await until(() => b.rejections.some((r) => r.code === 'gameOver'), 2000);

    // B 准备 → 全员准备 → 新对局
    b.rematchReady();
    await until(() => a.getState()?.turnNumber === 0, 3000);

    const newState = a.getState()!;
    expect(newState.turnNumber).toBe(0);
    expect(newState.status.kind).toBe('inProgress');
    expect(newState.actionLog).toHaveLength(0);
    expect(b.getState()).toEqual(newState); // 双方一致
    expect(a.playerId).toBe('A'); // 座位/playerId 保持
    expect(b.playerId).toBe('B');
    expect(server.getRoom('rm-1', '2p')!.rematchReadyPlayers()).toEqual([]); // 新局重置
    expect(server.getRoom('rm-1', '2p')!.timerPolicyMs()).toBeUndefined(); // 配置继承
    a.close();
    b.close();
  });

  it('客户端入口链路：rematch ready 经 session 入口真实发送并被服务器接受（Bug2 回归）', async () => {
    const server = await startServer({ mode: mode2p, seatIds: ['A', 'B'], seed: 9, roomId: 'rm-entry' });
    const a = await join('rm-entry', '2p');
    const b = await join('rm-entry', '2p');
    await untilStarted(a, b);
    a.resign();
    await until(() => a.getState()?.status.kind === 'won', 3000);

    // 浏览器按钮同链路：session.rematchReady()（此前断点曾在“UI→session”之间）
    a.rematchReady();
    await until(() => server.getRoom('rm-entry', '2p')!.rematchReadyPlayers().includes('A'), 2000);
    b.rematchReady();
    await until(() => a.getState()?.turnNumber === 0, 3000);
    expect(a.getState()!.turnNumber).toBe(0);
    a.close();
    b.close();
  });

  it('客户端入口链路：drawOffer 经 session 入口真实发送并被广播（Bug3 回归）', async () => {
    await startServer({ mode: mode2p, seatIds: ['A', 'B'], seed: 10, roomId: 'dr-entry' });
    const a = await join('dr-entry', '2p');
    const b = await join('dr-entry', '2p');
    await untilStarted(a, b);

    a.drawOffer();
    await until(() => b.drawOffers.length === 1, 2000);
    expect(b.drawOffers[0]).toMatchObject({ fromPlayerId: 'A', count: 1, max: 3 });
    b.drawResponse(true);
    await until(() => a.getState()?.status.kind === 'drawn', 3000);
    expect(a.getState()!.status).toEqual({ kind: 'drawn', reason: { kind: 'agreement' } });
    a.close();
    b.close();
  });

  it('rematch 开新局后原令牌仍可重连（客户端 token 恢复机制的服务器前提）', async () => {
    await startServer({ mode: mode2p, seatIds: ['A', 'B'], seed: 9, roomId: 'rm-token' });
    const a = await join('rm-token', '2p');
    const b = await join('rm-token', '2p');
    await untilStarted(a, b);
    const token = a.token; // 本局座位令牌

    // 终局：A 在自己的回合认输（当前行动玩家✓）→ B 胜
    a.resign();
    await until(() => a.getState()?.status.kind === 'won', 3000);

    // 双方仍在房间内→ rematch ×2 → 同房间开新局（座位/令牌保留）
    a.rematchReady();
    b.rematchReady();
    await until(
      () => a.getState()?.turnNumber === 0 && a.getState()?.status.kind === 'inProgress',
      3000,
    );

    // A 断线后用原令牌重连 → 恢复原座位，进入的是新局
    a.close();
    const again = await connectWebSocketGameSession({
      url: `ws://localhost:${serverPort}`, roomId: 'rm-token', mode: '2p', token,
    });
    expect(again.playerId).toBe('A');
    expect(again.getState()!.turnNumber).toBe(0);
    expect(again.getState()!.status.kind).toBe('inProgress');
    again.close();
    b.close();
  }, 30000);

  it('rematch 准备期间不可发起求和/认输（旧局已 terminal）', async () => {
    await startServer({ mode: mode2p, seatIds: ['A', 'B'], seed: 8, roomId: 'rm-2' });
    const a = await join('rm-2', '2p');
    const b = await join('rm-2', '2p');
    await untilStarted(a, b);
    a.resign();
    await until(() => a.getState()?.status.kind === 'won', 3000);

    b.drawOffer();
    await until(() => b.rejections.some((r) => r.code === 'drawRejected'), 2000);
    expect(b.rejections.some((r) => r.code === 'drawRejected')).toBe(true);
    a.close();
    b.close();
  });
});

function reveal(position: { x: number; y: number }): GameAction {
  return { kind: 'reveal', position };
}
