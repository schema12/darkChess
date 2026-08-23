import type { GameAction } from '../model/action';
import { pieceAt, withPiece } from '../model/board';
import type { GameState, MoveRecord } from '../model/game-state';
import type { ColorId } from '../model/ids';
import type { GameMode } from '../modes/game-mode';
import { computeRepetitionKey } from '../model/serialization';
import type { MoveValidation } from '../rules/validator';
import { createTurnManager } from '../rules/turn';

/**
 * 通用引擎（需求十八）：与具体玩法无关。
 * 只做：取得当前玩家 -> 汇集合法动作（翻棋/移动/吃子）-> 校验 -> 应用并结算胜负/和棋 -> 换手。
 * 不感知 4×8、红黑、棋子名、玩法细节；全部通过 GameMode 的 RuleSet 获得。
 */
export interface GameEngine {
  getLegalActions(state: GameState): readonly GameAction[];
  validate(state: GameState, action: GameAction): MoveValidation;
  apply(state: GameState, action: GameAction): GameState;
}

/** 基于某个 GameMode 创建通用引擎。 */
export function createEngine(mode: GameMode): GameEngine {
  const ruleSet = mode.ruleSet;
  const turnManager = createTurnManager();

  function currentPlayer(state: GameState) {
    return state.players.find((pl) => pl.id === state.currentPlayerId) ?? null;
  }

  function getLegalActions(state: GameState): GameAction[] {
    if (state.status.kind !== 'inProgress') return [];
    const cur = currentPlayer(state);
    if (!cur) return [];

    const actions: GameAction[] = [];

    // 移动/吃子：当前玩家已翻开、且属于自己阵营的棋子。
    for (const cell of state.board.cells) {
      const p = cell.piece;
      if (!p || !p.revealed) continue;
      if (cur.factionId !== null && mode.factionForColor(p.color) !== cur.factionId) continue;
      const rule = ruleSet.movement.get(p.type);
      if (!rule) continue;
      const from = { x: cell.x, y: cell.y };
      for (const to of rule.legalDestinations(state, from)) {
        actions.push({ kind: 'move', from, to });
      }
    }

    // 翻棋：所有未翻开格。
    for (const position of ruleSet.reveal.legalReveals(state)) {
      actions.push({ kind: 'reveal', position });
    }

    return actions;
  }

  function validate(state: GameState, action: GameAction): MoveValidation {
    if (state.status.kind !== 'inProgress') return { legal: false, reason: '游戏已结束' };

    if (action.kind === 'reveal') {
      const p = pieceAt(state.board, action.position);
      if (!p) return { legal: false, reason: '该位置没有棋子' };
      if (p.revealed) return { legal: false, reason: '该棋子已经翻开' };
      return { legal: true };
    }

    const p = pieceAt(state.board, action.from);
    if (!p) return { legal: false, reason: '起点没有棋子' };
    if (!p.revealed) return { legal: false, reason: '未翻开的棋子不能移动' };
    const cur = currentPlayer(state);
    if (!cur || cur.factionId === null) return { legal: false, reason: '阵营尚未确定，不能移动棋子' };
    if (mode.factionForColor(p.color) !== cur.factionId) return { legal: false, reason: '不能移动对方的棋子' };
    const rule = ruleSet.movement.get(p.type);
    if (!rule) return { legal: false, reason: '该棋子没有移动规则' };
    const dests = rule.legalDestinations(state, action.from);
    if (!dests.some((d) => d.x === action.to.x && d.y === action.to.y)) {
      return { legal: false, reason: '该移动不符合规则' };
    }
    return { legal: true };
  }

  function apply(state: GameState, action: GameAction): GameState {
    const v = validate(state, action);
    if (!v.legal) throw new Error(`非法动作: ${v.reason}`);

    let board = state.board;
    let wasCapture = false;
    let revealedColor: ColorId | null = null;

    if (action.kind === 'reveal') {
      const p = pieceAt(board, action.position);
      if (p) {
        board = withPiece(board, action.position, { ...p, revealed: true });
        revealedColor = p.color;
      }
    } else {
      const p = pieceAt(board, action.from);
      if (p) {
        wasCapture = pieceAt(board, action.to) !== null;
        board = withPiece(board, action.from, null);
        board = withPiece(board, action.to, p);
      }
    }

    // 首次翻棋确定阵营：翻出颜色 -> 翻棋者阵营，另一方为另一阵营（之后固定）。
    let players = state.players;
    if (revealedColor !== null && players.every((pl) => pl.factionId === null)) {
      const revealedFaction = mode.factionForColor(revealedColor);
      const otherFaction = mode.factions.find((f) => f.id !== revealedFaction);
      const currentId = state.currentPlayerId;
      players = players.map((pl) =>
        pl.id === currentId
          ? { ...pl, factionId: revealedFaction }
          : { ...pl, factionId: otherFaction ? otherFaction.id : pl.factionId },
      );
    }

    const turnNumber = state.turnNumber + 1;
    const noCaptureCount = wasCapture ? 0 : state.noCaptureCount + 1;
    const currentPlayerId = turnManager.nextPlayer(state);

    let next: GameState = {
      ...state,
      board,
      players,
      turnNumber,
      noCaptureCount,
      currentPlayerId,
    };

    const repetitionKey = computeRepetitionKey(next);
    const record: MoveRecord = {
      playerId: state.currentPlayerId,
      turnNumber,
      action,
      repetitionKey,
    };
    next = { ...next, repetitionKey, actionLog: [...state.actionLog, record] };

    // 结算胜负（消灭）。
    for (const wc of ruleSet.winConditions) {
      const winner = wc.evaluate(next);
      if (winner !== null) return { ...next, status: { kind: 'won', winner } };
    }

    // 结算和棋。
    for (const dc of ruleSet.drawConditions) {
      const reason = dc.evaluate(next);
      if (reason !== null) return { ...next, status: { kind: 'drawn', reason } };
    }

    // 无任何合法动作（无移动/吃子且无未翻棋子）-> 当前玩家判负。
    if (getLegalActions(next).length === 0) {
      const loser = currentPlayer(next);
      const winner = mode.factions.find((f) => f.id !== (loser ? loser.factionId : undefined));
      if (winner) return { ...next, status: { kind: 'won', winner: winner.id } };
    }

    return next;
  }

  return { getLegalActions, validate, apply };
}
