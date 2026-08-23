import { createBoard } from '../../model/board';
import { SCHEMA_VERSION } from '../../model/game-state';
import type { GameState } from '../../model/game-state';
import type { Player } from '../../model/player';
import { computeRepetitionKey } from '../../model/serialization';
import { mathRandomRng, mulberry32, shuffle } from '../../rng/rng';
import type { GameMode } from '../game-mode';
import {
  boardConfig,
  factionForColor,
  factions,
  MODE_ID,
  MODE_NAME,
  piecePool,
  PLAYER_A,
  PLAYER_B,
} from './config';
import { createRuleSet } from './rules';

/**
 * 玩法一：4×8 暗棋/翻棋。
 * createInitialState 随机打乱 32 棋子、全部背面朝上、玩家 A/B 阵营未定。
 */
export function createDarkChess4x8Mode(): GameMode {
  const ruleSet = createRuleSet();

  return {
    id: MODE_ID,
    name: MODE_NAME,
    boardConfig,
    factions,
    piecePool,
    ruleSet,
    factionForColor,

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

export * from './config';
