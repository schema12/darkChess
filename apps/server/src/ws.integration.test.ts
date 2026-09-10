import { afterAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  createDarkChess3p4x8Mode,
  createEngine,
  mulberry32,
} from '@darkchess/core';
import type { GameAction, GameState } from '@darkchess/core';
import { startDarkChessServer } from './index';
import type { ServerMessage } from './protocol';

const mode = createDarkChess3p4x8Mode();

interface TestClient {
  ws: WebSocket;
  messages: ServerMessage[];
  waitFor<T extends ServerMessage['type']>(
    type: T,
    timeoutMs?: number,
  ): Promise<Extract<ServerMessage, { type: T }>>;
  send(payload: unknown): void;
  close(): Promise<void>;
}

function connect(url: string): Promise<TestClient> {
  const ws = new WebSocket(url);
  const messages: ServerMessage[] = [];
  // 等待器采用“顺序消费”语义：同一类型的每次 waitFor 依次取下一条未消费消息。
  const consumed = new Map<ServerMessage['type'], number>();
  const waiters: Array<() => void> = [];

  ws.on('message', (raw) => {
    messages.push(JSON.parse(String(raw)) as ServerMessage);
    for (const check of [...waiters]) check();
  });

  const waitFor = <T extends ServerMessage['type']>(type: T, timeoutMs = 2000) =>
    new Promise<Extract<ServerMessage, { type: T }>>((resolve, reject) => {
      type Expected = Extract<ServerMessage, { type: T }>;
      let timer: ReturnType<typeof setTimeout>;
      const cleanup = () => {
        clearTimeout(timer);
        const index = waiters.indexOf(check);
        if (index >= 0) waiters.splice(index, 1);
      };
      const take = (): boolean => {
        const list = messages.filter((m) => m.type === type) as Expected[];
        const index = consumed.get(type) ?? 0;
        if (list.length > index) {
          consumed.set(type, index + 1);
          cleanup();
          resolve(list[index]!);
          return true;
        }
        return false;
      };
      const check = () => {
        take();
      };
      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`等待 ${type} 超时`));
      }, timeoutMs);
      waiters.push(check);
      take();
    });

  return new Promise((resolve, reject) => {
    ws.on('open', () =>
      resolve({
        ws,
        messages,
        waitFor,
        send: (payload) => ws.send(JSON.stringify(payload)),
        // 服务端可能已先行关闭（如满员拒绝）：readyState 已 CLOSED 时 ws.close()
        // 的回调不会触发，这里改用 close 事件 + 状态兜底。
        close: () =>
          new Promise((done) => {
            ws.once('close', done);
            if (ws.readyState === WebSocket.CLOSED) done();
            else ws.close();
          }),
      }),
    );
    ws.on('error', reject);
  });
}

describe('WebSocket 权威服务器（真实连接集成）', () => {
  let server: Awaited<ReturnType<typeof startDarkChessServer>>;
  const openClients: TestClient[] = [];

  afterAll(async () => {
    for (const client of openClients) await client.close().catch(() => undefined);
    await server?.close();
  });

  it('三人入座开局、第四人被拒、指令执行广播、三客户端状态一致、伪造 playerId 无效', async () => {
    server = await startDarkChessServer({
      mode,
      seatIds: ['A', 'B', 'C'],
      seed: 7,
    });
    const url = `ws://localhost:${server.port}`;

    const a = await connect(url);
    const b = await connect(url);
    const c = await connect(url);
    openClients.push(a, b, c);

    // 服务端分配座位，客户端无法自称是谁。
    const [wa, wb, wc] = await Promise.all([
      a.waitFor('welcome'),
      b.waitFor('welcome'),
      c.waitFor('welcome'),
    ]);
    expect([wa.playerId, wb.playerId, wc.playerId]).toEqual(['A', 'B', 'C']);

    // 满员自动开局：三个客户端都收到同一份权威初始状态。
    const [sa, sb, sc] = await Promise.all([a.waitFor('state'), b.waitFor('state'), c.waitFor('state')]);
    expect(sa.state.board.cells).toHaveLength(32);
    expect(sb.state).toEqual(sa.state);
    expect(sc.state).toEqual(sa.state);

    // 第四人连接：拒绝并关闭。
    const fourth = await connect(url);
    expect(await fourth.waitFor('rejected')).toMatchObject({ code: 'roomClosed' });
    await fourth.close();

    // A 提交合法翻棋：全部客户端收到推进后的同一状态。
    a.send({ type: 'command', action: { kind: 'reveal', position: { x: 0, y: 0 } } });
    const [sa2, sb2, sc2] = await Promise.all([
      a.waitFor('state'),
      b.waitFor('state'),
      c.waitFor('state'),
    ]);
    expect(sa2.state.turnNumber).toBe(1);
    expect(sa2.state.currentPlayerId).toBe('B');
    expect(sb2.state).toEqual(sa2.state);
    expect(sc2.state).toEqual(sa2.state);

    // B 试图在消息里伪造 playerId: 'A'——服务端按连接身份 B 处理（B 是当前玩家，指令被接受）。
    b.send({
      type: 'command',
      action: { kind: 'reveal', position: { x: 1, y: 0 } },
      playerId: 'A',
    });
    const sb3 = await b.waitFor('state');
    expect(sb3.state.turnNumber).toBe(2);
    expect(sb3.state.currentPlayerId).toBe('C');

    // 非当前玩家（A）的指令被拒。
    a.send({ type: 'command', action: { kind: 'reveal', position: { x: 2, y: 0 } } });
    expect(await a.waitFor('rejected')).toMatchObject({ code: 'notCurrentPlayer' });

    // 当前玩家（C）的非法动作被拒。
    c.send({
      type: 'command',
      action: { kind: 'move', from: { x: 0, y: 0 }, to: { x: 0, y: 1 } },
    });
    expect(await c.waitFor('rejected')).toMatchObject({ code: 'illegalAction' });
  });
});

describe('阶段 6 最终验收：完整三人随机对局（真实 WebSocket）', () => {
  let server: Awaited<ReturnType<typeof startDarkChessServer>>;
  const openClients: TestClient[] = [];

  afterAll(async () => {
    for (const client of openClients) await client.close().catch(() => undefined);
    await server?.close();
  });

  it('三名客户端随机对局直至终局：全程广播一致、淘汰合法、无伪造可行', async () => {
    server = await startDarkChessServer({
      mode: createDarkChess3p4x8Mode(),
      seatIds: ['A', 'B', 'C'],
      seed: 1234,
    });
    const url = `ws://localhost:${server.port}`;
    const engine = createEngine(mode); // 客户端视图推导与权威引擎同源

    const clients = [];
    for (let i = 0; i < 3; i++) {
      const client = await connect(url);
      openClients.push(client);
      const welcome = await client.waitFor('welcome');
      clients.push({ ...client, playerId: welcome.playerId });
    }

    // 初始状态（第三个 welcome 触发开局广播）。
    const firstStates = await Promise.all(clients.map((c) => c.waitFor('state')));
    let state: GameState = firstStates[0]!.state;
    for (const s of firstStates) expect(s.state).toEqual(state);

    const rng = mulberry32(20240910);
    const byId = new Map(clients.map((c) => [c.playerId, c]));
    let turns = 0;

    while (state.status.kind === 'inProgress' && turns < 500) {
      const current = byId.get(state.currentPlayerId)!;
      // 客户端仅做视图推导选动作；合法性最终由服务端权威判定。
      const actions = engine.getLegalActions(state);
      expect(actions.length).toBeGreaterThan(0);
      const action = actions[rng.nextInt(actions.length)]! as GameAction;

      current.send({ type: 'command', action });
      // 三个客户端各收到一次广播：逐一消费，保证队列对齐。
      const seen: GameState[] = [];
      for (const c of clients) {
        const msg = await c.waitFor('state');
        seen.push(msg.state);
      }
      state = seen[0]!;
      for (const s of seen) expect(s).toEqual(state); // 广播一致性
      expect(state.turnNumber).toBe(turns + 1);
      // 权威不变量：当前回合绝不落在已淘汰玩家身上。
      expect(state.players.find((p) => p.id === state.currentPlayerId)?.eliminated).not.toBe(true);
      turns += 1;
    }

    expect(turns).toBeGreaterThan(0);
    expect(state.status.kind).not.toBe('inProgress'); // 正常终局（胜/和），无卡死
    // 三客户端最终权威状态完全一致。
    const finals = clients.map((c) => c.messages.filter((m) => m.type === 'state').at(-1)!.state);
    expect(finals[0]).toEqual(finals[1]);
    expect(finals[1]).toEqual(finals[2]);
    expect(finals[0]).toEqual(state);
  }, 20000);
});
