import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { createDarkChess3p4x8Mode } from '@darkchess/core';
import type { GameMode, PlayerId } from '@darkchess/core';
import { createGameRoom } from './room';
import type { GameRoom, RoomConnection } from './room';
import type { ClientMessage } from './protocol';

export interface ModeConfig {
  /** URL ?mode= 的取值（如 '2p' | '3p'）。 */
  readonly key: string;
  readonly mode: GameMode;
  readonly seatIds: readonly PlayerId[];
}

export interface DarkChessServerOptions {
  /** 默认模式（连接未携带 ?mode= 时使用；保持既有行为）。 */
  readonly mode: GameMode;
  /** 默认模式座位 id（3P 为 A/B/C）。 */
  readonly seatIds: readonly PlayerId[];
  /** 额外可选模式（如 2P）；连接以 ?mode=<key> 选择。 */
  readonly extraModes?: readonly ModeConfig[];
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
  getRoom(roomId: string, modeKey?: string): GameRoom | null;
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
  // 默认模式配置：内部键固定为 '__default__'（?mode= 未携带或未知时兜底）。
  const defaultConfig: ModeConfig = { key: '__default__', mode: options.mode, seatIds: options.seatIds };
  const modeConfigs = new Map<string, ModeConfig>(
    (options.extraModes ?? []).map((m) => [m.key, m]),
  );

  const rooms = new Map<string, GameRoom>();

  // 房间内部键含模式前缀（按请求的 modeKey 原样存储，未注册的 key 回退默认配置）：
  // 保证 join 与 reconnect 用同一把键，2P/3P 房间互不干扰。
  // 计时策略（?timer= 秒数）在房间创建时固定；后加入者沿用房间既有策略。
  const roomFor = (roomId: string, modeKey: string | null, timerMs?: number): GameRoom => {
    const cfg = modeKey !== null ? (modeConfigs.get(modeKey) ?? defaultConfig) : defaultConfig;
    const key = `${modeKey ?? '__default__'}:${roomId}`;
    const existing = rooms.get(key);
    if (existing) return existing;
    const room = createGameRoom({
      roomId,
      mode: cfg.mode,
      seatIds: cfg.seatIds,
      seed: options.seed,
      turnTimeoutMs: timerMs ?? options.turnTimeoutMs,
    });
    rooms.set(key, room);
    return room;
  };

  roomFor(defaultRoomId, null); // 默认房间预先存在（保持单房间使用方式不变）

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
    const modeKey = params.get('mode');
    const token = params.get('token');
    // 计时策略：?timer=<秒>（房间创建时生效）；off/缺省 = 不限时。
    const timerParam = params.get('timer');
    const timerSec = timerParam !== null && /^\d+$/.test(timerParam) ? Number(timerParam) : undefined;
    const timerMs = timerSec !== undefined ? Math.min(600, Math.max(5, timerSec)) * 1000 : undefined;
    // 连接生命周期内固定使用同一房间（模式/计时在入座时确定）。
    // rejoin 命中 finished 房间时会被替换，故用 let 让消息/断线处理器跟随新房间。
    let room = roomFor(roomId, modeKey, timerMs);

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

    if (token !== null) {
      // 重连：令牌仅在连接所属模式的房间中查找（2P/3P 令牌互相隔离，杜绝跨模式恢复）。
      const prefix = `${modeKey ?? '__default__'}:`;
      for (const [key, candidate] of rooms) {
        if (!key.startsWith(prefix)) continue;
        const result = candidate.rejoin(token, handle);
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
      let result = room.join(handle);
      if (!result.ok && room.getStatus() === 'finished') {
        // terminal Room 不阻塞新游戏：显式的新 join 以全新对局替换同名房间。
        // 旧对局的最终结果此前已广播送达；其旧 token 随旧座位一并失效。
        rooms.delete(`${modeKey ?? '__default__'}:${roomId}`);
        room = roomFor(roomId, modeKey);
        result = room.join(handle);
      }
      if (result.ok && result.playerId !== undefined) {
        playerId = result.playerId;
      } else {
        // 最终失败（roomFull / 活跃房间 roomClosed）才通知客户端。
        handle.send({ type: 'rejected', code: result.code ?? 'roomClosed', reason: result.reason ?? '无法加入房间' });
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
          return rooms.get(`__default__:${defaultRoomId}`)!;
        },
        getRoom(roomId: string, modeKey?: string) {
          if (modeKey !== undefined) return rooms.get(`${modeKey}:${roomId}`) ?? null;
          // 未指定模式：先查默认模式，再退而扫描全部模式前缀（单模式部署兼容）。
          const def = rooms.get(`__default__:${roomId}`);
          if (def) return def;
          for (const [key, room] of rooms) {
            if (key.endsWith(`:${roomId}`)) return room;
          }
          return null;
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
