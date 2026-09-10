import type { GameAction } from '../model/action';
import { pieceAt, withPiece } from '../model/board';
import type { GameState, MoveRecord } from '../model/game-state';
import type { ColorId, PlayerId } from '../model/ids';
import type { PieceType } from '../model/piece';
import type { GameMode } from '../modes/game-mode';
import { computeRepetitionKey } from '../model/serialization';
import type { MoveValidation } from '../rules/validator';
import { createTurnManager, nextActivePlayerId } from '../rules/turn';

/**
 * 通用引擎（需求十八）：与具体玩法无关。
 * 只做：取得当前玩家 -> 汇集合法动作（翻棋/移动/吃子）-> 校验 -> 应用 -> 结算 -> 换手；
 * 结算顺序固定：胜负条件 -> 和棋条件 -> 僵局规则。
 * 阵营绑定与僵局处置均委托给 RuleSet，引擎不假设玩家数/阵营数及其对应关系
 * （“首次翻棋定阵营”“无动作判负”等属于具体玩法规则）。
 * forfeit 是权威判负入口（超时/认输）：只标记玩家淘汰并重新结算，不触碰棋盘。
 */
export interface GameEngine {
  getLegalActions(state: GameState): readonly GameAction[];
  validate(state: GameState, action: GameAction): MoveValidation;
  apply(state: GameState, action: GameAction): GameState;
  /** 权威判负（超时/认输的统一入口）：淘汰指定玩家并重新结算终局。 */
  forfeit(state: GameState, playerId: PlayerId): GameState;
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
    if (!cur || cur.eliminated === true) return [];

    const actions: GameAction[] = [];

    // 移动/吃子：当前玩家已绑定阵营、已翻开、且属于自己阵营的棋子。
    // 未绑定阵营的玩家只能翻棋（与 validate 的拒绝语义保持一致）。
    for (const cell of state.board.cells) {
      const p = cell.piece;
      if (!p || !p.revealed) continue;
      if (cur.factionId === null || mode.factionOf(p) !== cur.factionId) continue;
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

    // 防御：已淘汰玩家不能通过任何动作重新获得行动权。
    const actingPlayer = currentPlayer(state);
    if (actingPlayer && actingPlayer.eliminated === true) {
      return { legal: false, reason: '该玩家已被淘汰，不能行动' };
    }

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
    if (mode.factionOf(p) !== cur.factionId) return { legal: false, reason: '不能移动对方的棋子' };
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
    let revealedType: PieceType | null = null;

    if (action.kind === 'reveal') {
      const p = pieceAt(board, action.position);
      if (p) {
        board = withPiece(board, action.position, { ...p, revealed: true });
        revealedColor = p.color;
        revealedType = p.type;
      }
    } else {
      const p = pieceAt(board, action.from);
      if (p) {
        wasCapture = pieceAt(board, action.to) !== null;
        board = withPiece(board, action.from, null);
        board = withPiece(board, action.to, p);
      }
    }

    const turnNumber = state.turnNumber + 1;
    const noCaptureCount = wasCapture ? 0 : state.noCaptureCount + 1;
    const currentPlayerId = turnManager.nextPlayer(state);

    let next: GameState = {
      ...state,
      board,
      players: state.players,
      turnNumber,
      noCaptureCount,
      currentPlayerId,
    };

    // 阵营绑定完全交给 RuleSet（非翻棋动作 event 为 null，绑定时机由玩法自行判断）。
    const revealEvent =
      revealedColor !== null && revealedType !== null
        ? { revealerId: state.currentPlayerId, revealedColor, revealedType }
        : null;
    const players = ruleSet.factionBinding.apply(next, revealEvent);
    if (players !== next.players) {
      next = { ...next, players };
    }

    const repetitionKey = computeRepetitionKey(next);
    const record: MoveRecord = {
      playerId: state.currentPlayerId,
      turnNumber,
      action,
      repetitionKey,
    };
    next = { ...next, repetitionKey, actionLog: [...state.actionLog, record] };

    return settle(next);
  }

  // 终局结算：胜负 -> 和棋 -> 僵局处置。僵局处置可能改写状态（如多人玩法
  // 淘汰当前玩家），需从头重新结算；以玩家数为上限防止病态规则导致死循环。
  // 二人玩法的处置只会返回 ended，循环至多一轮。
  function settle(input: GameState): GameState {
    let next = input;
    for (let guard = 0; guard <= next.players.length; guard++) {
      // 结算胜负（阵营判据 / 玩家判据）。
      for (const wc of ruleSet.winConditions) {
        const outcome = wc.evaluate(next);
        if (outcome === null) continue;
        if (outcome.kind === 'faction') {
          return { ...next, status: { kind: 'won', winner: outcome.winner } };
        }
        const winnerPlayer = next.players.find((p) => p.id === outcome.winner);
        return {
          ...next,
          status: {
            kind: 'won',
            winner: winnerPlayer?.factionId ?? null,
            winnerPlayerId: outcome.winner,
          },
        };
      }

      // 结算和棋。
      for (const dc of ruleSet.drawConditions) {
        const reason = dc.evaluate(next);
        if (reason !== null) return { ...next, status: { kind: 'drawn', reason } };
      }

      // 当前玩家无任何合法动作（无移动/吃子且无未翻棋子）：如何处置由玩法决定。
      if (getLegalActions(next).length > 0) return next;
      const resolution = ruleSet.stalemate.resolve(next);
      if (resolution === null) return next;
      if (resolution.kind === 'ended') return { ...next, status: resolution.status };
      next = resolution.state;
    }
    return next;
  }

  /**
   * 权威判负（超时/认输的统一入口）：将指定玩家淘汰并重新结算终局。
   * 淘汰只标记玩家——棋盘与阵营棋子一律不变（玩家淘汰 ≠ 阵营棋子消失）；
   * 被判负者是当前玩家时轮转到下一位未淘汰玩家，否则行动权不变（认输场景）。
   * 不产生动作记录，不影响和棋计数；仅权威方（本地会话/未来服务端）可调用，
   * 客户端不得借此自行修改淘汰状态。
   */
  function forfeit(state: GameState, playerId: PlayerId): GameState {
    if (state.status.kind !== 'inProgress') {
      throw new Error(`对局已结束，不能判负: ${playerId}`);
    }
    const target = state.players.find((p) => p.id === playerId);
    if (!target) throw new Error(`未知玩家: ${playerId}`);
    if (target.eliminated === true) throw new Error(`玩家已被淘汰: ${playerId}`);

    const players = state.players.map((p) =>
      p.id === playerId ? { ...p, eliminated: true } : p,
    );
    let currentPlayerId = state.currentPlayerId;
    if (playerId === state.currentPlayerId) {
      const nextId = nextActivePlayerId({ ...state, players }, playerId);
      if (nextId === null) throw new Error('判负结算时没有可轮转的未淘汰玩家');
      currentPlayerId = nextId;
    }
    const next: GameState = { ...state, players, currentPlayerId };
    return settle({ ...next, repetitionKey: computeRepetitionKey(next) });
  }

  return { getLegalActions, validate, apply, forfeit };
}
