import type { PieceType } from '../model/piece';
import { assert, buildState, canMoveTo, engine, mode, moveTargets } from './helpers';

export interface TestCase {
  name: string;
  run: () => void;
}

const ALL: readonly PieceType[] = [
  'KING',
  'ADVISOR',
  'ELEPHANT',
  'ROOK',
  'KNIGHT',
  'CANNON',
  'PAWN',
];

const CAN: Record<PieceType, readonly PieceType[]> = {
  KING: ['ADVISOR', 'ELEPHANT', 'ROOK', 'KNIGHT', 'CANNON', 'KING'],
  ADVISOR: ['ELEPHANT', 'ROOK', 'KNIGHT', 'CANNON', 'PAWN', 'ADVISOR'],
  ELEPHANT: ['ROOK', 'KNIGHT', 'CANNON', 'PAWN', 'ELEPHANT'],
  ROOK: ALL,
  KNIGHT: ALL,
  CANNON: ALL,
  PAWN: ['PAWN', 'KING'],
};

export const cases: TestCase[] = [
  {
    name: '吃子表 7×7 全量校验（含同类互吃）',
    run() {
      for (const attacker of ALL) {
        for (const defender of ALL) {
          const expected = CAN[attacker].includes(defender);
          const actual = mode.ruleSet.capture.canCapture(attacker, defender);
          assert(actual === expected, `${attacker} 吃 ${defender} 应=${expected} 实=${actual}`);
        }
      }
    },
  },

  {
    name: '将/帅、士/仕、象/相、兵/卒：上下左右各 1 格',
    run() {
      for (const type of ['KING', 'ADVISOR', 'ELEPHANT', 'PAWN'] as const) {
        const s = buildState([{ x: 1, y: 1, type, color: 'RED', revealed: true }]);
        const t = moveTargets(s, { x: 1, y: 1 });
        assert(t.has('0,1') && t.has('2,1') && t.has('1,0') && t.has('1,2'), `${type} 应有上下左右 4 步`);
        assert(t.size === 4, `${type} 应恰有 4 个目标，实际 ${t.size}`);
      }
    },
  },

  {
    name: '马：对角 1 格，无蹩马腿',
    run() {
      const s = buildState([{ x: 1, y: 1, type: 'KNIGHT', color: 'RED', revealed: true }]);
      const t = moveTargets(s, { x: 1, y: 1 });
      assert(t.has('0,0') && t.has('2,0') && t.has('0,2') && t.has('2,2'), '马应有 4 个对角目标');
      assert(t.size === 4, `马应恰有 4 个目标，实际 ${t.size}`);
      assert(!t.has('2,1'), '马不能直走');
      assert(!t.has('3,3'), '马不能斜走 2 格');
    },
  },

  {
    name: '车：直线任意格、可吃首个敌子、不可越子',
    run() {
      let s = buildState([{ x: 1, y: 1, type: 'ROOK', color: 'RED', revealed: true }]);
      let t = moveTargets(s, { x: 1, y: 1 });
      assert(t.has('3,1') && t.has('0,1') && t.has('1,7') && t.has('1,0'), '车可到直线远端');

      // 己方阻挡
      s = buildState([
        { x: 1, y: 1, type: 'ROOK', color: 'RED', revealed: true },
        { x: 2, y: 1, type: 'PAWN', color: 'RED', revealed: true },
      ]);
      t = moveTargets(s, { x: 1, y: 1 });
      assert(!t.has('2,1'), '车不能进入己方格');
      assert(!t.has('3,1'), '车不能越过己方棋子');
      assert(t.has('0,1'), '车另一侧仍可走');

      // 未翻棋子阻挡
      s = buildState([
        { x: 1, y: 1, type: 'ROOK', color: 'RED', revealed: true },
        { x: 2, y: 1, type: 'PAWN', color: 'BLACK', revealed: false },
        { x: 3, y: 1, type: 'PAWN', color: 'BLACK', revealed: true },
      ]);
      t = moveTargets(s, { x: 1, y: 1 });
      assert(!t.has('2,1'), '车不能进入未翻格');
      assert(!t.has('3,1'), '车不能越过未翻棋子');

      // 吃首个敌子后不可继续
      s = buildState([
        { x: 1, y: 1, type: 'ROOK', color: 'RED', revealed: true },
        { x: 2, y: 1, type: 'ROOK', color: 'BLACK', revealed: true },
        { x: 3, y: 1, type: 'PAWN', color: 'BLACK', revealed: true },
      ]);
      t = moveTargets(s, { x: 1, y: 1 });
      assert(t.has('2,1'), '车可吃相邻敌车');
      assert(!t.has('3,1'), '车吃子后不能继续越过');
    },
  },

  {
    name: '炮：移动不可越子、不可打空炮、吃子恰隔一子',
    run() {
      // 普通移动：可到屏幕前空格，不能越过屏幕打空炮
      let s = buildState([
        { x: 1, y: 1, type: 'CANNON', color: 'RED', revealed: true },
        { x: 1, y: 3, type: 'PAWN', color: 'BLACK', revealed: true },
      ]);
      let t = moveTargets(s, { x: 1, y: 1 });
      assert(t.has('1,2'), '炮可到屏幕前空格');
      assert(!t.has('1,3'), '炮不能到屏幕位置');
      assert(!t.has('1,4'), '炮不能越过屏幕打空炮');

      // 恰一个炮架可吃
      s = buildState([
        { x: 1, y: 1, type: 'CANNON', color: 'RED', revealed: true },
        { x: 1, y: 3, type: 'PAWN', color: 'BLACK', revealed: true },
        { x: 1, y: 4, type: 'ROOK', color: 'BLACK', revealed: true },
      ]);
      t = moveTargets(s, { x: 1, y: 1 });
      assert(t.has('1,4'), '炮恰隔一子可吃');

      // 无炮架不能吃相邻敌
      s = buildState([
        { x: 1, y: 1, type: 'CANNON', color: 'RED', revealed: true },
        { x: 1, y: 2, type: 'ROOK', color: 'BLACK', revealed: true },
      ]);
      t = moveTargets(s, { x: 1, y: 1 });
      assert(!t.has('1,2'), '炮无炮架不能吃相邻敌');

      // 两个炮架不能吃
      s = buildState([
        { x: 1, y: 1, type: 'CANNON', color: 'RED', revealed: true },
        { x: 1, y: 2, type: 'PAWN', color: 'BLACK', revealed: true },
        { x: 1, y: 3, type: 'PAWN', color: 'BLACK', revealed: true },
        { x: 1, y: 4, type: 'ROOK', color: 'BLACK', revealed: true },
      ]);
      t = moveTargets(s, { x: 1, y: 1 });
      assert(!t.has('1,4'), '炮隔两子不能吃');

      // 炮架可为未翻棋子
      s = buildState([
        { x: 1, y: 1, type: 'CANNON', color: 'RED', revealed: true },
        { x: 1, y: 3, type: 'PAWN', color: 'BLACK', revealed: false },
        { x: 1, y: 4, type: 'ROOK', color: 'BLACK', revealed: true },
      ]);
      t = moveTargets(s, { x: 1, y: 1 });
      assert(t.has('1,4'), '炮架可为未翻棋子');
    },
  },

  {
    name: '共同限制：未翻/己方/不可吃敌子不可作为移动目标',
    run() {
      // 未翻
      let s = buildState([
        { x: 1, y: 1, type: 'ROOK', color: 'RED', revealed: true },
        { x: 2, y: 1, type: 'ROOK', color: 'BLACK', revealed: false },
      ]);
      assert(!canMoveTo(s, { x: 1, y: 1 }, { x: 2, y: 1 }), '不能移动到未翻棋子');

      // 己方
      s = buildState([
        { x: 1, y: 1, type: 'ROOK', color: 'RED', revealed: true },
        { x: 2, y: 1, type: 'ROOK', color: 'RED', revealed: true },
      ]);
      assert(!canMoveTo(s, { x: 1, y: 1 }, { x: 2, y: 1 }), '不能吃己方棋子');

      // 不能吃的敌子（王 vs 兵）
      s = buildState([
        { x: 1, y: 1, type: 'KING', color: 'RED', revealed: true },
        { x: 2, y: 1, type: 'PAWN', color: 'BLACK', revealed: true },
      ]);
      assert(!canMoveTo(s, { x: 1, y: 1 }, { x: 2, y: 1 }), '王不能吃兵');
    },
  },

  {
    name: '翻棋：消耗一个回合并换手，归属由棋子颜色决定',
    run() {
      const s0 = buildState(
        [{ x: 1, y: 1, type: 'KNIGHT', color: 'BLACK', revealed: false }],
        { currentPlayer: 'A' },
      );
      const reveals = engine.getLegalActions(s0).filter((a) => a.kind === 'reveal');
      assert(reveals.length === 1, '有一个可翻棋子');
      const s1 = engine.apply(s0, reveals[0]!);
      assert(s1.turnNumber === 1, '翻棋消耗一回合');
      assert(s1.currentPlayerId === 'B', '翻棋后换手');
      const cell = s1.board.cells.find((c) => c.x === 1 && c.y === 1)!;
      assert(cell.piece?.revealed === true, '棋子已翻开');
      assert(cell.piece?.color === 'BLACK', '棋子归属由颜色决定（黑），与翻棋者 A 无关');
    },
  },

  {
    name: '胜负：一方棋子全被吃光即判负',
    run() {
      const s0 = buildState(
        [
          { x: 1, y: 1, type: 'ROOK', color: 'BLACK', revealed: true },
          { x: 2, y: 1, type: 'PAWN', color: 'RED', revealed: true },
        ],
        { currentPlayer: 'B' },
      );
      const s1 = engine.apply(s0, { kind: 'move', from: { x: 1, y: 1 }, to: { x: 2, y: 1 } });
      assert(s1.status.kind === 'won' && s1.status.winner === 'BLACK', '红方被吃光后黑胜');
    },
  },

  {
    name: '胜负：无合法移动且无未翻棋子时当前玩家判负',
    run() {
      const s0 = buildState(
        [
          { x: 0, y: 0, type: 'KING', color: 'RED', revealed: true },
          { x: 1, y: 0, type: 'PAWN', color: 'BLACK', revealed: true },
          { x: 0, y: 1, type: 'PAWN', color: 'BLACK', revealed: true },
          { x: 3, y: 7, type: 'PAWN', color: 'BLACK', revealed: true },
        ],
        { currentPlayer: 'B' },
      );
      const s1 = engine.apply(s0, { kind: 'move', from: { x: 3, y: 7 }, to: { x: 3, y: 6 } });
      assert(s1.currentPlayerId === 'A', '轮到 A');
      assert(engine.getLegalActions(s1).length === 0, 'A 无任何合法动作');
      assert(s1.status.kind === 'won' && s1.status.winner === 'BLACK', 'A 判负，黑胜');
    },
  },

  {
    name: '和棋：连续未吃子达到阈值判和',
    run() {
      const s0 = buildState(
        [
          { x: 1, y: 1, type: 'ROOK', color: 'RED', revealed: true },
          { x: 2, y: 1, type: 'ROOK', color: 'BLACK', revealed: true },
        ],
        { currentPlayer: 'A', noCaptureCount: 39 },
      );
      const s1 = engine.apply(s0, { kind: 'move', from: { x: 1, y: 1 }, to: { x: 1, y: 2 } });
      assert(s1.status.kind === 'drawn' && s1.status.reason.kind === 'noCapture', '未吃子达阈值判和');
    },
  },

  {
    name: '和棋：重复局面达到 5 次判和',
    run() {
      let s = buildState(
        [
          { x: 1, y: 1, type: 'ROOK', color: 'RED', revealed: true },
          { x: 3, y: 1, type: 'ROOK', color: 'BLACK', revealed: true },
        ],
        { currentPlayer: 'A' },
      );
      // 两车来回走，局面每 4 步回到同一位置；同一局面第 5 次出现时判和。
      const seq = [
        { from: { x: 1, y: 1 }, to: { x: 2, y: 1 } },
        { from: { x: 3, y: 1 }, to: { x: 3, y: 2 } },
        { from: { x: 2, y: 1 }, to: { x: 1, y: 1 } },
        { from: { x: 3, y: 2 }, to: { x: 3, y: 1 } },
      ];
      let guard = 0;
      while (s.status.kind === 'inProgress' && guard < 40) {
        const m = seq[guard % 4]!;
        s = engine.apply(s, { kind: 'move', from: m.from, to: m.to });
        guard += 1;
      }
      assert(s.status.kind === 'drawn' && s.status.reason.kind === 'repetition', '重复局面达 5 次判和');
      assert(guard <= 20, `应在 20 步内判和，实际 ${guard} 步`);
    },
  },
];
