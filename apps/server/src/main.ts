import { createDarkChess3p4x8Mode, createDarkChess4x8Mode } from '@darkchess/core';
import { startDarkChessServer } from './index';

/** 可运行入口：`pnpm --filter @darkchess/server dev` 启动权威服务器（2P + 3P）。 */
const mode3p = createDarkChess3p4x8Mode();
const mode2p = createDarkChess4x8Mode();
const port = Number(process.env.PORT ?? 8787);

void startDarkChessServer({
  mode: mode3p,
  seatIds: ['A', 'B', 'C'],
  extraModes: [
    { key: '3p', mode: mode3p, seatIds: ['A', 'B', 'C'] },
    { key: '2p', mode: mode2p, seatIds: ['A', 'B'] },
  ],
  port,
}).then((server) => {
  console.log(`DarkChess server listening on ws://localhost:${server.port} (modes: 2p, 3p)`);
  console.log(`HTTP room status: http://localhost:${server.port}/`);
});
