import { afterAll, describe, expect, it } from 'vitest';
import os from 'node:os';
import { createDarkChess3p4x8Mode } from '@darkchess/core';
import { startDarkChessServer } from './index';
import { connectWebSocketGameSession } from './client/websocket-session';

/**
 * 局域网访问验证：服务器必须监听所有网络接口（0.0.0.0/::），使局域网设备
 * 能通过 PC 的 LAN IP 连接（手机浏览器 ws://<PC-IP>:8787）。
 *
 * 验证方式：取本机非内部 IPv4 地址（局域网网卡），从该地址发起真实 WebSocket
 * 连接并完成房间入座。无 LAN 网卡（离线单机）时跳过。
 */
function lanIPv4(): string | null {
  const interfaces = os.networkInterfaces();
  for (const list of Object.values(interfaces)) {
    for (const info of list ?? []) {
      if (info.family === 'IPv4' && !info.internal) return info.address;
    }
  }
  return null;
}

describe('局域网访问（WebSocket 绑定与真实建连）', () => {
  let server: Awaited<ReturnType<typeof startDarkChessServer>>;

  afterAll(async () => {
    await server?.close();
  });

  it('从本机局域网 IP 发起 WebSocket 连接可正常入座', async () => {
    const ip = lanIPv4();
    if (ip === null) {
      console.log('[skip] 本机无非内部 IPv4 地址（离线环境），跳过 LAN 建连测试');
      return;
    }

    server = await startDarkChessServer({
      mode: createDarkChess3p4x8Mode(),
      seatIds: ['A', 'B', 'C'],
      seed: 1,
      roomId: 'lan-check',
    });

    // 与手机浏览器相同的路径：URL 主机名为 LAN IP 而非 localhost。
    const session = await connectWebSocketGameSession({
      url: `ws://${ip}:${server.port}`,
      roomId: 'lan-check',
      connectTimeoutMs: 4000,
    });

    expect(session.playerId).toBe('A');
    expect(session.getState()).toBeNull(); // 等待其他玩家
    session.close();
  }, 15000);
});
