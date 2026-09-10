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
  /** 默认房间 id（客户端未指定 ?room= 时使用）。 */
  readonly roomId?: string;
  readonly seed?: number;
  readonly turnTimeoutMs?: number;
}

export interface RunningServer {
  readonly port: number;
  /** 默认房间（roomId 未指定时的公共房间）。 */
  readonly room: GameRoom;
  /** 按需创建的全部房间（含默认房间）。 */
  getRoom(roomId: string): GameRoom | null;
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
 *
 * 路由：连接 URL `?room=<id>` 选择房间（缺省创建/加入默认房间），
 * `?token=<重连令牌>` 跨房间恢复座位（令牌由服务端在 welcome 时发放）。
 *
 * 安全边界：客户端声明的 playerId 等字段一律忽略——身份只在 join/rejoin 时
 * 由服务端绑定到连接；指令身份取自连接，而非消息体。
 */
export function startDarkChessServer(options: DarkChessServerOptions): Promise<RunningServer> {
  const defaultRoomId = options.roomId ?? 'room-1';
  const rooms = new Map<string, GameRoom>();

  const roomFor = (roomId: string): GameRoom => {
    const existing = rooms.get(roomId);
    if (existing) return existing;
    const room = createGameRoom({
      roomId,
      mode: options.mode,
      seatIds: options.seatIds,
      seed: options.seed,
      turnTimeoutMs: options.turnTimeoutMs,
    });
    rooms.set(roomId, room);
    return room;
  };

  roomFor(defaultRoomId); // 默认房间预先存在（保持单房间使用方式不变）

  const http = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        rooms: [...rooms.values()].map((room) => ({
          roomId: room.roomId,
          status: room.getStatus(),
          players: room.playersInfo(),
        })),
      }),
    );
  });
  const wss = new WebSocketServer({ server: http });

  wss.on('connection', (ws, request) => {
    const params = new URL(request.url ?? '/', 'http://localhost').searchParams;
    const roomId = params.get('room') ?? defaultRoomId;
    const token = params.get('token');

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
      roomFor(roomId).handleClientMessage(playerId, parsed);
    });
    ws.on('close', () => {
      if (playerId !== null) roomFor(roomId).disconnect(handle);
    });

    if (token !== null) {
      // 重连：令牌跨房间查找（令牌为服务端发放的唯一凭据）。
      for (const room of rooms.values()) {
        const result = room.rejoin(token, handle);
        if (result.ok && result.playerId !== undefined) {
          playerId = result.playerId;
          break;
        }
      }
      if (playerId === null) {
        handle.send({ type: 'rejected', code: 'invalidToken', reason: '无效的重连令牌' });
        handle.close();
      }
    } else {
      const result = roomFor(roomId).join(handle);
      if (result.ok && result.playerId !== undefined) {
        playerId = result.playerId;
      } else {
        handle.close();
      }
    }
  });

  return new Promise((resolve) => {
    http.listen(options.port ?? 0, () => {
      const address = http.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        port,
        get room() {
          return rooms.get(defaultRoomId)!;
        },
        getRoom(roomId: string) {
          return rooms.get(roomId) ?? null;
        },
        close: () =>
          new Promise((done) => {
            for (const room of rooms.values()) room.close();
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
