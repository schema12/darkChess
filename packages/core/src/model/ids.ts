/**
 * 不透明身份标识。
 *
 * 需求二十三要求：玩家 / 阵营 / 棋子颜色 / 玩法分离，
 * 避免 `if (player === RED)` 散落全项目。
 * 因此这些 id 一律使用 string，而不是硬编码枚举。
 * 当前玩法中三者恰好一一对应（A=RED、B=BLACK），
 * 但模型允许未来出现 3 玩家、多阵营、玩家与阵营不完全一一对应、非红黑颜色。
 */
export type ColorId = string; // 棋子自身颜色（墨色），当前为 'RED' | 'BLACK'
export type FactionId = string; // 阵营/势力，当前与 ColorId 一一对应
export type PlayerId = string; // 座位/玩家，当前为 'A' | 'B'
export type PieceId = string; // 棋子实例唯一 id
