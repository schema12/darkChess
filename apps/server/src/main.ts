import { createDarkChess3p4x8Mode } from '@darkchess/core';
import { defaultSeatIdsFor, startDarkChessServer } from './index';

/** 可运行入口：`pnpm --filter @darkchess/server dev` 启动三人权威服务器。 */
const mode = createDarkChess3p4x8Mode();
const port = Number(process.env.PORT ?? 8787);

void startDarkChessServer({
  mode,
  seatIds: defaultSeatIdsFor(mode),
  port,
}).then((server) => {
  console.log(`DarkChess 3P server listening on ws://localhost:${server.port}`);
  console.log(`HTTP room status: http://localhost:${server.port}/`);
});
