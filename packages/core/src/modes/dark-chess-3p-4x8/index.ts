import { createBoard } from '../../model/board';
import { SCHEMA_VERSION } from '../../model/game-state';
import type { GameState } from '../../model/game-state';
import type { Player } from '../../model/player';
import { computeRepetitionKey } from '../../model/serialization';
import { mathRandomRng, mulberry32, shuffle } from '../../rng/rng';
import type { GameMode } from '../game-mode';
import {
  boardConfig,
  factionOfPiece,
  factions,
  MODE_ID,
  MODE_NAME,
  piecePool,
  PLAYER_A,
  PLAYER_B,
  PLAYER_C,
} from './config';
import { createRuleSet } from './rules';

/**
 * 玩法二：三人 4×8 暗棋。
 * createInitialState 随机打乱 32 棋子、全部背面朝上、玩家 A/B/C 阵营均未定。
 */
export function createDarkChess3p4x8Mode(): GameMode {
  const ruleSet = createRuleSet();

  return {
    id: MODE_ID,
    name: MODE_NAME,
    boardConfig,
    factions,
    piecePool,
    ruleSet,
    factionOf: factionOfPiece,

    createInitialState(seed?: number): GameState {
      const rng = seed === undefined ? mathRandomRng() : mulberry32(seed);
      const pieces = piecePool.map((spec, i) => ({
        id: `p${i}`,
        type: spec.type,
        color: spec.color,
        revealed: false,
      }));
      const shuffled = shuffle(pieces, rng);
      const board = createBoard(boardConfig.width, boardConfig.height, shuffled);

      const players: Player[] = [
        { id: PLAYER_A, name: null, factionId: null },
        { id: PLAYER_B, name: null, factionId: null },
        { id: PLAYER_C, name: null, factionId: null },
      ];

      const state: GameState = {
        schemaVersion: SCHEMA_VERSION,
        modeId: MODE_ID,
        board,
        players,
        currentPlayerId: PLAYER_A,
        turnNumber: 0,
        noCaptureCount: 0,
        status: { kind: 'inProgress' },
        repetitionKey: '',
        actionLog: [],
      };

      return { ...state, repetitionKey: computeRepetitionKey(state) };
    },
  };
}

// 注意：此处不 `export * from './config'`——与 dark-chess-4x8 存在大量同名导出
// （MODE_ID/piecePool/阈值等），两个玩法都从包根导出会冲突；外部如需三人配置，
// 直接从 './modes/dark-chess-3p-4x8/config' 导入。
