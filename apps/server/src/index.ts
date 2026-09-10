import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { createDarkChess3p4x8Mode } from '@darkchess/core';
import type { GameMode, PlayerId } from '@darkchess/core';
import { createGameRoom } from './room';
import type { GameRoom, RoomConnection } from './room';
import type { ClientMessage } from './protocol';

export interface DarkChessServerOptions {
  readonly mode: GameMode;
  /** 座位 id（3P 为 A/B/C）。 */
  readonly seatIds: readonly PlayerId[];
  readonly port?: number;
  readonly roomId?: string;
  readonly seed?: number;
  readonly turnTimeoutMs?: number;
}

export interface RunningServer {
  readonly port: number;
  readonly room: GameRoom;
  close(): Promise<void>;
}

/** 客户端消息的最小运行时校验（解析失败/未知类型直接丢弃）。 */
function isClientMessage(value: unknown): value is ClientMessage {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as { type?: unknown }).type;
  if (type === 'command') {
    const action = (value as { action?: unknown }).action;
    return typeof action === 'object' && action !== null;
  }
  return type === 'resign';
}

/**
 * WebSocket 桥接：把传输连接绑定到权威房间的座位身份。
 * 安全边界：客户端声明的 playerId 等字段一律忽略——身份只在 join/rejoin 时
 * 由服务端发放（join 分配座位，rejoin 凭令牌恢复）。
 */
export function startDarkChessServer(options: DarkChessServerOptions): Promise<RunningServer> {
  const room = createGameRoom({
    roomId: options.roomId ?? 'room-1',
    mode: options.mode,
    seatIds: options.seatIds,
    seed: options.seed,
    turnTimeoutMs: options.turnTimeoutMs,
  });

  const http = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ roomId: room.roomId, status: room.getStatus(), players: room.playersInfo() }));
  });
  const wss = new WebSocketServer({ server: http });

  wss.on('connection', (ws, request) => {
    const handle: RoomConnection = {
      send(message) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
      },
      close() {
        ws.close();
      },
    };
    let playerId: PlayerId | null = null;

    ws.on('message', (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (playerId === null || !isClientMessage(parsed)) return;
      room.handleClientMessage(playerId, parsed);
    });
    ws.on('close', () => {
      if (playerId !== null) room.disconnect(handle);
    });

    // 重连：URL 携带 ?token=... 恢复原座位；否则作为新玩家入座。
    const token = new URL(request.url ?? '/', 'http://localhost').searchParams.get('token');
    const result = token !== null ? room.rejoin(token, handle) : room.join(handle);
    if (result.ok && result.playerId !== undefined) {
      playerId = result.playerId;
    } else {
      handle.close();
    }
  });

  return new Promise((resolve) => {
    http.listen(options.port ?? 0, () => {
      const address = http.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        port,
        room,
        close: () =>
          new Promise((done) => {
            room.close();
            // terminate：立即断开全部客户端连接，避免 close 握手悬挂。
            // （ws 8.x 中 clients 是 Set 属性，不是方法。）
            for (const client of wss.clients) client.terminate();
            wss.close();
            http.close(() => done());
          }),
      });
    });
  });
}

/** 默认入口：三人房间。 */
export function defaultSeatIdsFor(mode: GameMode): readonly PlayerId[] {
  return mode.id === 'dark-chess-3p-4x8' ? ['A', 'B', 'C'] : ['A', 'B'];
}
