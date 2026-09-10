// 数据模型
export * from './model/ids';
export * from './model/piece';
export * from './model/board';
export * from './model/player';
export * from './model/faction';
export * from './model/action';
export * from './model/game-state';
export * from './model/serialization';

// 规则引擎
export * from './rules/capture';
export * from './rules/movement';
export * from './rules/reveal';
export * from './rules/validator';
export * from './rules/win-condition';
export * from './rules/draw-condition';
export * from './rules/rule-set';
export * from './rules/turn';
export * from './rules/faction-binding';
export * from './rules/stalemate';

// 引擎
export * from './engine/game-engine';

// 会话/协议层（多人化基础：带发送者的指令 + 权威校验/执行 + 会话抽象）
export * from './session/command';
export * from './session/game-session';

// 玩法抽象与具体玩法
export * from './modes/game-mode';
export * from './modes/dark-chess-4x8';
// 三人玩法不整包导出（与两人玩法存在同名导出冲突），只导出模式工厂。
export { createDarkChess3p4x8Mode } from './modes/dark-chess-3p-4x8';
export type { ThreePlayerRuleOptions } from './modes/dark-chess-3p-4x8/rules';

// 随机源
export * from './rng/rng';
