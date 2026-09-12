import { afterAll, describe, expect, it } from 'vitest';
import {
  createDarkChess3p4x8Mode,
  createDarkChess4x8Mode,
} from '@darkchess/core';
import { startDarkChessServer } from './index';
import type { RunningServer } from './index';
import { connectWebSocketGameSession } from './client/websocket-session';

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

async function until(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('条件等待超时');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('Stage 10：计时策略矩阵（创建者决定，服务器权威）', () => {
  for (const timerSec of [30, 60, 90, 120] as const) {
    it(`创建 ${timerSec}s 计时房：广播剩余时间与策略一致，第二人加入不改配置`, async () => {
      const server = await startServer({
        mode: mode2p, seatIds: ['A', 'B'], seed: 100 + timerSec, roomId: `tm-${timerSec}`,
      });
      const seen: Array<number | null> = [];
      const a = await connectWebSocketGameSession({
        url: `ws://localhost:${serverPort}`, roomId: `tm-${timerSec}`, mode: '2p', timerSec,
        onState: (_s, rem) => seen.push(rem),
      });
      const b = await connectWebSocketGameSession({
        url: `ws://localhost:${serverPort}`, roomId: `tm-${timerSec}`, mode: '2p',
        timerSec: 5, // 加入者声明不同计时 → 必须被忽略（配置权威在房主/服务器）
        onState: (_s, rem) => seen.push(rem),
      });
      await until(() => seen.length >= 2, 2000);
      for (const rem of seen) {
        expect(rem).toBeLessThanOrEqual(timerSec);
        expect(rem).toBeGreaterThan(timerSec - 10);
      }
      expect(server.getRoom(`tm-${timerSec}`, '2p')!.timerPolicyMs()).toBe(timerSec * 1000);
      a.close();
      b.close();
    });
  }

  it('不限时：无计时字段，创建者配置不被加入者覆盖', async () => {
    const server = await startServer({ mode: mode2p, seatIds: ['A', 'B'], seed: 200, roomId: 'tm-off' });
    const seen: Array<number | null> = [];
    const a = await connectWebSocketGameSession({
      url: `ws://localhost:${serverPort}`, roomId: 'tm-off', mode: '2p',
      onState: (_s, rem) => seen.push(rem),
    });
    const b = await connectWebSocketGameSession({
      url: `ws://localhost:${serverPort}`, roomId: 'tm-off', mode: '2p', timerSec: 30,
      onState: (_s, rem) => seen.push(rem),
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(seen.every((x) => x === null)).toBe(true); // 全部 null = 不限时
    expect(server.getRoom('tm-off', '2p')!.timerPolicyMs()).toBeUndefined();
    a.close();
    b.close();
  });
});

describe('Stage 10：Host 与房间配置权威', () => {
  it('A 创建（timer 60）→ B 加入：配置不变并广播给加入者；房主标记正确', async () => {
    const server = await startServer({
      mode: mode2p, seatIds: ['A', 'B'], seed: 300, roomId: 'host-1',
      extraModes: [{ key: '3p', mode: mode3p, seatIds: ['A', 'B', 'C'] }],
    });
    const configs: Array<{ modeId: string; timerSec: number | null }> = [];
    const a = await connectWebSocketGameSession({
      url: `ws://localhost:${serverPort}`, roomId: 'host-1', mode: '2p', timerSec: 60,
    });
    const b = await connectWebSocketGameSession({
      url: `ws://localhost:${serverPort}`, roomId: 'host-1', mode: '2p',
      onRoomStatus: (_st, _pl, cfg) => configs.push(cfg),
    });
    await until(() => configs.length > 0, 2000);

    expect(configs[configs.length - 1]).toEqual({ modeId: 'dark-chess-4x8', timerSec: 60 });
    expect(server.getRoom('host-1', '2p')!.timerPolicyMs()).toBe(60000); // B 的声明未生效
    const players = server.getRoom('host-1', '2p')!.playersInfo();
    expect(players.find((p) => p.playerId === 'A')?.isHost).toBe(true);
    expect(players.find((p) => p.playerId === 'B')?.isHost).toBe(false);
    a.close();
    b.close();
  });

  it('roomStatus 携带配置：加入者能看到房主设定的模式与计时', async () => {
    const server = await startServer({
      mode: mode3p, seatIds: ['A', 'B', 'C'], seed: 301, roomId: 'host-3p', turnTimeoutMs: 45000,
      extraModes: [{ key: '2p', mode: mode2p, seatIds: ['A', 'B'] }],
    });
    const configs: Array<{ modeId: string; timerSec: number | null }> = [];
    const a = await connectWebSocketGameSession({
      url: `ws://localhost:${serverPort}`, roomId: 'host-3p', mode: '3p',
      onRoomStatus: (_st, _pl, cfg) => configs.push(cfg),
    });
    await until(() => configs.length > 0, 2000);
    expect(configs[configs.length - 1]).toEqual({ modeId: 'dark-chess-3p-4x8', timerSec: 45 });
    void server;
    a.close();
  });
});

describe('Stage 10：Duplicate Player（自己和自己联机防护）', () => {
  it('等待房全员离线 → 房间自毁；重入获得全新单一座位（A×1）', async () => {
    const server = await startServer({ mode: mode2p, seatIds: ['A', 'B'], seed: 400, roomId: 'dup-wait' });
    const a = await connectWebSocketGameSession({ url: `ws://localhost:${serverPort}`, roomId: 'dup-wait', mode: '2p' });
    expect(a.playerId).toBe('A');
    const token = a.token;
    a.close(); // 离开等待房
    await until(() => server.getRoom('dup-wait', '2p') === null, 2000); // 空等待房自毁

    // 无 token 重入：全新房间，仅占一个座位
    const again = await connectWebSocketGameSession({ url: `ws://localhost:${serverPort}`, roomId: 'dup-wait', mode: '2p' });
    expect(again.playerId).toBe('A');
    expect(server.getRoom('dup-wait', '2p')!.playersInfo()).toHaveLength(1);
    void token;
    again.close();
  });

  it('对局中一方无 token 重入：不产生第二座位（roomClosed 拒绝，无自自联机）', async () => {
    const server = await startServer({ mode: mode2p, seatIds: ['A', 'B'], seed: 401, roomId: 'dup-play' });
    const a = await connectWebSocketGameSession({ url: `ws://localhost:${serverPort}`, roomId: 'dup-play', mode: '2p' });
    const b = await connectWebSocketGameSession({ url: `ws://localhost:${serverPort}`, roomId: 'dup-play', mode: '2p' });
    await until(() => a.getState() !== null, 2000);
    a.close(); // 对局中掉线（座位保留供 token 重连）

    // 同一人丢失令牌后无 token 重入 → 两个座位均被占 → roomFull，绝不会 A + A
    await expect(
      connectWebSocketGameSession({ url: `ws://localhost:${serverPort}`, roomId: 'dup-play', mode: '2p' }),
    ).rejects.toThrow(/roomClosed/);
    expect(server.getRoom('dup-play', '2p')!.playersInfo()).toHaveLength(2);
    b.close();
  });
});

describe('Stage 10：空房间生命周期（idle 暂停计时 + TTL 回收）', () => {
  it('对局中全员离线：计时暂停（剩余冻结）；TTL 到期回收房间', async () => {
    const server = await startServer({
      mode: mode2p, seatIds: ['A', 'B'], seed: 500, roomId: 'idle-1',
      turnTimeoutMs: 30000, idleTtlMs: 1500,
    });
    const samples: Array<number | null> = [];
    const a = await connectWebSocketGameSession({
      url: `ws://localhost:${serverPort}`, roomId: 'idle-1', mode: '2p',
      onState: (_s, rem) => samples.push(rem),
    });
    const b = await connectWebSocketGameSession({ url: `ws://localhost:${serverPort}`, roomId: 'idle-1', mode: '2p' });
    await until(() => samples.length > 0 && samples[0] !== null, 2000);
    const remainingAtLeave = samples[0]!;
    const token = a.token;

    a.close();
    b.close(); // 全员离线 → 计时冻结 + TTL(1.5s) 启动
    await new Promise((r) => setTimeout(r, 300));

    // 回归玩家：带令牌重连（真实路径）→ 恢复原座位，剩余时间被冻结在离开时附近
    const back = await connectWebSocketGameSession({
      url: `ws://localhost:${serverPort}`, roomId: 'idle-1', mode: '2p', token,
      onState: (_s, rem) => samples.push(rem),
    });
    expect(back.playerId).toBe('A'); // 恢复原座位而非新建
    await until(() => samples.length > 1 && samples[samples.length - 1] !== null, 2000);
    const resumed = samples[samples.length - 1]!;
    expect(resumed).toBeGreaterThan(remainingAtLeave - 3); // 暂停而非走表（允许 3s 采样误差）
    expect(resumed).toBeLessThanOrEqual(30);
    await until(() => server.getRoom('idle-1', '2p')?.getStatus() === 'playing', 2000);

    // TTL 回收：再次全员离线 1.5s 后房间销毁
    back.close();
    b.close();
    await until(() => server.getRoom('idle-1', '2p') === null, 4000);
  });

  it('等待房零在线自毁不误伤对局中的房间（playing 保留）', async () => {
    const server = await startServer({ mode: mode2p, seatIds: ['A', 'B'], seed: 501, roomId: 'idle-2' });
    const a = await connectWebSocketGameSession({ url: `ws://localhost:${serverPort}`, roomId: 'idle-2', mode: '2p' });
    const b = await connectWebSocketGameSession({ url: `ws://localhost:${serverPort}`, roomId: 'idle-2', mode: '2p' });
    await until(() => a.getState() !== null, 2000);
    b.close(); // 对局中一人离线（在线数 1，不触发回收）
    await new Promise((r) => setTimeout(r, 200));
    expect(server.getRoom('idle-2', '2p')).not.toBeNull();
    expect(server.getRoom('idle-2', '2p')!.getStatus()).toBe('playing');
    a.close();
    // 全员离线 → playing 空闲保留（TTL 默认 10 分钟，不立即销毁）
    await new Promise((r) => setTimeout(r, 200));
    expect(server.getRoom('idle-2', '2p')).not.toBeNull();
  });
});
