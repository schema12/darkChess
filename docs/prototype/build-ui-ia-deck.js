// DarkChess UI 信息架构 · 低保真原型施工图 v0.1
// 生成：node build-ui-ia-deck.js（输出到 docs/，不影响生产代码）
const pptxgen = require("pptxgenjs");

const P = new pptxgen();
P.layout = "LAYOUT_WIDE"; // 13.33 × 7.5
P.author = "DarkChess";
P.title = "DarkChess UI 信息架构与低保真原型 v0.1";

const W = 13.33, H = 7.5, M = 0.5;
const F = "微软雅黑";
// 配色：项目木色系（深棕背景 / 木色主色 / 金色强调），线框用暖灰
const C = {
  bg: "FFFFFF", dark: "2B2118", darkTxt: "F7EFD9", darkMut: "C9B98F",
  pri: "8A6D3B", acc: "E8930C", txt: "2B2118", mut: "8C7B63",
  wf: "F6F2E9", wfs: "8A6D3B", fut: "A79E8D", futf: "F3F1EC", grid: "C9BCA3", cell: "EFE8DA",
};
const TOTAL = 16;

let s = null;
function newSlide(bg = C.bg) { s = P.addSlide(); s.background = { color: bg }; return s; }
let pageNo = 0;
function foot() {
  pageNo += 1;
  if (pageNo === 1) return;
  s.addText("DarkChess · UI 信息架构 · 低保真施工图 v0.1", { x: M, y: H - 0.34, w: 4.5, h: 0.24, fontSize: 12, fontFace: F, color: C.mut, margin: 0 });
  s.addText(`${pageNo} / ${TOTAL}`, { x: W - 1.3, y: H - 0.34, w: 0.8, h: 0.24, fontSize: 12, fontFace: F, color: C.mut, align: "right", margin: 0 });
}
function hdr(kick, title) {
  s.addText(kick, { x: M, y: 0.26, w: 9, h: 0.26, fontSize: 12, fontFace: F, color: C.acc, bold: true, margin: 0, charSpacing: 2 });
  s.addText(title, { x: M, y: 0.52, w: 10.5, h: 0.55, fontSize: 27, fontFace: F, color: C.txt, bold: true, margin: 0 });
}
function wire(x, y, w, h, o = {}) {
  s.addShape(P.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h, rectRadius: 0.05,
    fill: { color: o.fill || C.wf },
    line: { color: o.stroke || C.wfs, width: o.wd || 1.25, dashType: o.dash ? "dash" : "solid" },
  });
}
function T(t, x, y, w, h, o = {}) {
  s.addText(t, {
    x, y, w, h, fontSize: o.fs || 12, fontFace: F, color: o.color || C.txt,
    bold: !!o.bold, align: o.align || "left", valign: o.val || "middle", margin: 0,
  });
}
// 状态图例 chip：kind = have(已有) / mod(改造) / new(新建) / fut(Future)
function chip(kind, x, y, o = {}) {
  const map = {
    have: { t: "已有", fill: C.pri, txt: "FFFFFF", dash: false },
    mod: { t: "改造", fill: C.acc, txt: "FFFFFF", dash: false },
    new: { t: "新建", fill: "FFFFFF", txt: C.pri, dash: false },
    fut: { t: "Future", fill: C.futf, txt: C.fut, dash: true },
  }[kind];
  const label = o.label || map.t;
  const w = o.w || 0.34 + label.length * 0.16;
  s.addShape(P.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h: 0.28, rectRadius: 0.14,
    fill: { color: map.fill }, line: { color: map.dash ? C.fut : map.fill, width: 1, dashType: map.dash ? "dash" : "solid" },
  });
  T(label, x, y, w, 0.28, { fs: 12, color: map.txt, align: "center", bold: kind === "have" });
  return w;
}
// 页面框（浏览器窗口式）：标题栏 + 路由标签
function pageFrame(x, y, w, h, route, title, active = null) {
  wire(x, y, w, h, { fill: "FFFFFF", wd: 1.5 });
  s.addShape(P.shapes.LINE, { x, y: y + 0.42, w, h: 0, line: { color: C.wfs, width: 1 } });
  T(title || "DarkChess", x + 0.15, y, w - 1.6, 0.42, { fs: 12, bold: true, color: C.mut });
  T(route, x + w - 1.7, y, 1.55, 0.42, { fs: 12, color: C.acc, align: "right", bold: true });
  if (active) { // 底部三 Tab 导航（首页/联机/设置）
    const nbY = y + h - 0.5, nbW = w / 3;
    ["首页", "联机", "设置"].forEach((t, i) => {
      if (t === active) s.addShape(P.shapes.ROUNDED_RECTANGLE, { x: x + i * nbW + 0.08, y: nbY + 0.06, w: nbW - 0.16, h: 0.36, rectRadius: 0.06, fill: { color: C.pri }, line: { color: C.pri, width: 1 } });
      T(t, x + i * nbW, nbY + 0.06, nbW, 0.36, { align: "center", fs: 12, bold: t === active, color: t === active ? "FFFFFF" : C.mut });
    });
  }
}
function arrow(x1, y1, x2, y2, o = {}) {
  s.addShape(P.shapes.LINE, {
    x: x1, y: y1, w: x2 - x1, h: y2 - y1,
    line: { color: o.color || C.pri, width: o.wd || 2, endArrowType: "triangle", dashType: o.dash ? "dash" : "solid" },
  });
}
function boardGrid(x, y, cellW, cellH, cols = 8, rows = 4, g = 0.03) {
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    s.addShape(P.shapes.ROUNDED_RECTANGLE, { x: x + c * (cellW + g), y: y + r * (cellH + g), w: cellW, h: cellH, rectRadius: 0.03, fill: { color: C.cell }, line: { color: C.grid, width: 0.75 } });
  }
}

/* ============ S1 封面 ============ */
newSlide(C.dark); foot();
T("DarkChess · 暗棋", M, 1.5, 12.3, 0.5, { fs: 20, color: C.darkMut, bold: true, charSpacing: 3 });
s.addText("UI 信息架构与低保真原型", { x: M, y: 2.05, w: 12.3, h: 1.1, fontSize: 47, fontFace: F, color: C.darkTxt, bold: true, margin: 0 });
T("产品骨架施工图 —— 先定“功能放在哪里”，再做视觉设计", M, 3.25, 12.3, 0.4, { fs: 17, color: C.darkMut });
// 四入口预览
const entries = ["本地双人", "本地三人", "联机双人", "联机三人"];
entries.forEach((t, i) => {
  const x = M + i * 2.15;
  wire(x, 4.15, 1.95, 0.62, { fill: "3A2C1D", stroke: "6B5433" });
  T(t, x, 4.15, 1.95, 0.62, { align: "center", fs: 14, color: C.darkTxt, bold: true });
});
T("依据：评审通过后作为下一阶段 UI 实现的施工依据 · 不改变任何游戏规则 / 协议 / 核心逻辑", M, 5.35, 12.3, 0.35, { fs: 13, color: C.darkMut });
T("v0.1 · 基线 v0.3.0-ws-client · 2026-09", M, 6.9, 6, 0.3, { fs: 12, color: C.darkMut });

/* ============ S2 当前 UI 现状与问题 ============ */
newSlide(); foot();
hdr("现状盘点 · AS-IS", "当前 UI：单屏堆叠，缺少产品骨架");
// 左：现状线框
const ax = M, ay = 1.35, aw = 5.7, ah = 5.5;
pageFrame(ax, ay, aw, ah, "app.tsx（单屏）", "现状：一个页面承载全部");
wire(ax + 0.15, ay + 0.55, aw - 0.3, 0.4, { fill: "FFFFFF" });
T("本地·两人   本地·三人   联机·三人   ← 模式切换按钮", ax + 0.2, ay + 0.55, aw - 0.4, 0.4, { fs: 12, align: "center", color: C.mut });
T("轮到 玩家A（将帅兵卒阵营）· 第 4 手          [新对局]", ax + 0.15, ay + 1.05, aw - 0.3, 0.3, { fs: 12 });
wire(ax + 0.15, ay + 1.42, aw - 0.3, 0.62);
T("玩家A 将帅兵卒阵营 ｜ 玩家B 红色棋子阵营 ｜ 玩家C 黑色棋子阵营", ax + 0.25, ay + 1.42, aw - 0.5, 0.62, { fs: 12 });
boardGrid(ax + 0.85, ay + 2.2, 0.47, 0.47, 8, 4);
T("连续未吃子：3 / 40", ax + 0.15, ay + 4.35, aw - 0.3, 0.28, { fs: 12, color: C.mut });
s.addText([
  { text: "联机中：房间 room-1 · 本机玩家 C", options: { breakLine: true } },
  { text: "上次操作被拒：notCurrentPlayer: 尚未轮到该玩家行动", options: { color: "B4452A", bold: true } },
], { x: ax + 0.15, y: ay + 4.68, w: aw - 0.3, h: 0.62, fontSize: 12, fontFace: F, margin: 0, valign: "top" });
// 右：问题清单
const issues = [
  ["没有首页", "游戏页面顶部长期挂着模式切换按钮，页面职责混淆"],
  ["四个入口不完整", "联机只有三人入口，联机双人无法进入（服务端已支持 2 座位）"],
  ["没有设置页", "音效不可关、默认服务器不可配、无版本信息"],
  ["调试信息上屏", "notCurrentPlayer 等错误码直接展示给用户"],
  ["信息全堆一层", "回合/提示/和棋进度/联机状态混排，无 Header/状态区分层"],
  ["Overlay 无体系", "淘汰、终局、断线各自独立实现，无统一层级规范"],
];
issues.forEach(([t, d], i) => {
  const y = 1.35 + i * 0.92;
  T(String(i + 1).padStart(2, "0"), 6.65, y, 0.62, 0.5, { fs: 22, bold: true, color: C.acc });
  T(t, 7.35, y, 5.4, 0.32, { fs: 15, bold: true });
  T(d, 7.35, y + 0.34, 5.45, 0.5, { fs: 12, color: C.mut });
  if (i < issues.length - 1) s.addShape(P.shapes.LINE, { x: 6.65, y: y + 0.84, w: 6.15, h: 0, line: { color: C.line, width: 0.75 } });
});
s.addNotes("现状核对自 apps/web/src：App.tsx 单屏 + 顶部三按钮；GameView 三态（等待/断线/对局）；组件 PlayerPanel/BoardView/StatusBar/DrawProgress/EliminationNotices/GameResultOverlay/ConnectionPanel 均存在，问题在信息组织而非组件缺失。");

/* ============ S3 信息架构总览（Sitemap） ============ */
newSlide(); foot();
hdr("信息架构 · SITEMAP", "三级页面结构：一级 3 页 + 游戏页 + 三级房间");
// 图例
T("图例：", M, 1.18, 0.7, 0.28, { fs: 12, color: C.mut });
let lx = 1.2;
["have", "mod", "new", "fut"].forEach((k) => { lx += chip(k, lx, 1.18) + 0.12; });
T("= 现状标注（已有 / 需改造 / 需新建 / 仅占位）", lx + 0.05, 1.18, 5.5, 0.28, { fs: 12, color: C.mut });
// 一级节点
const L1 = [
  { t: "首页（开始）", route: "/", st: "mod", x: M, w: 2.5 },
  { t: "联机", route: "/online", st: "mod", x: 4.35, w: 2.5 },
  { t: "设置", route: "/settings", st: "new", x: 8.2, w: 2.5 },
];
L1.forEach((n) => {
  wire(n.x, 1.75, n.w, 0.75, { fill: "FFFFFF", wd: 1.75 });
  T(n.t, n.x, 1.8, n.w, 0.4, { align: "center", fs: 16, bold: true });
  T(n.route, n.x, 2.18, n.w, 0.26, { align: "center", fs: 12, color: C.acc });
  chip(n.st, n.x + n.w - 0.75, 1.82);
});
T("底部导航三 Tab（移动端同构）", 10.95, 1.9, 2.2, 0.5, { fs: 12, color: C.mut });
// 首页二级（内容卡）
wire(M, 2.95, 2.5, 1.7);
T("本地双人暗棋", M + 0.15, 3.05, 2.2, 0.3, { fs: 13, bold: true }); chip("have", M + 1.75, 3.07);
T("点击即开局 → GamePage", M + 0.15, 3.38, 2.3, 0.28, { fs: 12, color: C.mut });
T("本地三人暗棋", M + 0.15, 3.75, 2.2, 0.3, { fs: 13, bold: true }); chip("have", M + 1.75, 3.77);
T("热座轮流 · 进入 GamePage", M + 0.15, 4.08, 2.3, 0.28, { fs: 12, color: C.mut });
T("首页即“开始游戏”选择页（二级为内容卡，不设独立页）", M, 4.75, 2.6, 0.6, { fs: 12, color: C.mut });
arrow(M + 1.25, 4.65, 4.3, 6.05); // 首页卡 -> GamePage
// 联机二级
wire(4.35, 2.95, 2.5, 1.05);
T("模式选择：双人联机 / 三人联机", 4.45, 3.03, 2.35, 0.5, { fs: 12, bold: true });
chip("mod", 4.5, 3.55); chip("fut", 5.25, 3.55, { label: "双人联机·Future" });
T("三级：房间页（服务器 / 房间 ID / 座位 / 重连）", 4.35, 4.1, 2.6, 0.55, { fs: 12, color: C.mut });
arrow(5.6, 4.7, 5.6, 5.15);
wire(4.35, 5.15, 2.5, 0.85);
T("房间页 Room", 4.45, 5.22, 1.7, 0.3, { fs: 13, bold: true }); chip("have", 6.15, 5.24);
T("满员自动开局 → GamePage", 4.45, 5.55, 2.35, 0.28, { fs: 12, color: C.mut });
arrow(6.9, 5.55, 8.6, 6.15);
// 设置二级
wire(8.2, 2.95, 2.5, 1.05);
["游戏", "音效", "外观", "联机", "关于"].forEach((t, i) => {
  T(t, 8.3 + (i % 3) * 0.82, 3.05 + Math.floor(i / 3) * 0.42, 0.8, 0.3, { fs: 12, color: C.mut });
});
chip("new", 8.3, 3.6);
T("五个分组，明细见设置页", 8.3, 4.1, 2.4, 0.3, { fs: 12, color: C.mut });
// GamePage 节点
wire(8.6, 6.15, 4.2, 0.85, { wd: 2 });
T("GamePage（游戏进行页）", 8.75, 6.22, 2.9, 0.35, { fs: 16, bold: true });
chip("mod", 11.9, 6.25);
T("本地 / 联机共用 · 信息分区见后页", 8.75, 6.6, 3.9, 0.3, { fs: 12, color: C.mut });
arrow(2.9, 5.55 + 0.4, 8.55, 6.35, { dash: true }); // 房间->GamePage 虚线已完成
T("房间页箭头：联机开局后进入 GamePage（联机态）", 4.5, 6.6, 3.9, 0.55, { fs: 12, color: C.mut });

/* ============ S4 页面清单与现状 ============ */
newSlide(); foot();
hdr("页面清单 · PAGE LIST", "哪些已有、哪些改造、哪些只是占位");
const rows = [
  ["页面", "路由建议", "层级", "现状", "说明"],
  ["首页（开始）", "/", "一级", "改造", "新增底部导航；本地两入口即首页内容卡"],
  ["联机模式选择", "/online", "二级", "改造", "现 ConnectionPanel 升级为模式选择 + 入口"],
  ["联机房间（3P）", "/online/room", "三级", "已有", "连接/座位/等待/重连，逻辑全部已实现"],
  ["联机房间（2P）", "/online/room?2p", "三级", "Future", "服务端已支持 2 座位，UI 仅留入口"],
  ["GamePage", "/game/:mode", "一级（全屏）", "改造", "复用全部现有组件，仅做信息分区重排"],
  ["设置", "/settings", "一级", "新建", "五分组；音效/默认服务器可先实装"],
  ["最近对局", "首页占位区", "Future", "Future", "需要持久化，当前仅虚线占位"],
  ["好友 / 邀请", "房间页占位", "Future", "Future", "依赖账号体系，不实现"],
  ["对局记录 / 复盘", "Future", "Future", "Future", "actionLog 已具雏形，产品后置"],
];
const tbl = rows.map((r, i) => r.map((c, j) => ({
  text: c,
  options: i === 0
    ? { fill: { color: C.pri }, color: "FFFFFF", bold: true, fontSize: 13 }
    : { fontSize: 12, color: j === 3 ? (c === "Future" ? C.fut : C.txt) : C.txt, bold: j === 0, fill: { color: i % 2 ? "FBF9F4" : "FFFFFF" } },
})));
s.addTable(tbl, {
  x: M, y: 1.35, w: 12.33, colW: [2.5, 2.2, 1.5, 1.3, 4.83],
  border: { pt: 0.75, color: C.grid }, rowH: 0.46, fontFace: F, valign: "middle", margin: 0.06,
});
T("结论：没有页面需要推倒重做 —— 一级/二级是“重排与补壳”，三级房间页逻辑已在 Stage 4–7 完成。", M, 6.75, 12.3, 0.35, { fs: 13, bold: true, color: C.pri });

/* ============ S5 一级：首页 ============ */
newSlide(); foot();
hdr("一级页面 · 首页（开始）", "首页 = 本地模式选择页，四入口在两张图内讲清");
pageFrame(M, 1.3, 7.6, 5.7, "/", "DarkChess", "首页");
T("DarkChess 暗棋", M + 0.3, 1.95, 7, 0.5, { fs: 22, bold: true });
T("快速开始", M + 0.3, 2.55, 3, 0.3, { fs: 12, color: C.mut });
// 本地两卡
wire(M + 0.3, 2.9, 3.35, 1.5, { fill: "FFFFFF", wd: 1.75 });
T("本地双人暗棋", M + 0.5, 3.05, 2.4, 0.35, { fs: 15, bold: true }); chip("have", M + 2.85, 3.1);
T("两人热座 · 同一屏幕轮流操作", M + 0.5, 3.45, 3, 0.3, { fs: 12, color: C.mut });
s.addShape(P.shapes.ROUNDED_RECTANGLE, { x: M + 0.5, y: 3.85, w: 1.3, h: 0.38, rectRadius: 0.06, fill: { color: C.pri }, line: { color: C.pri, width: 1 } });
T("开始", M + 0.5, 3.85, 1.3, 0.38, { align: "center", fs: 12, color: "FFFFFF", bold: true });
wire(M + 3.85, 2.9, 3.35, 1.5, { fill: "FFFFFF", wd: 1.75 });
T("本地三人暗棋", M + 4.05, 3.05, 2.4, 0.35, { fs: 15, bold: true }); chip("have", M + 6.4, 3.1);
T("三人热座 · 三阵营渐进绑定", M + 4.05, 3.45, 3, 0.3, { fs: 12, color: C.mut });
s.addShape(P.shapes.ROUNDED_RECTANGLE, { x: M + 4.05, y: 3.85, w: 1.3, h: 0.38, rectRadius: 0.06, fill: { color: C.pri }, line: { color: C.pri, width: 1 } });
T("开始", M + 4.05, 3.85, 1.3, 0.38, { align: "center", fs: 12, color: "FFFFFF", bold: true });
// 联机大入口
wire(M + 0.3, 4.65, 6.9, 0.85, { fill: "FFFFFF", wd: 1.75 });
T("联机对战", M + 0.55, 4.75, 2, 0.4, { fs: 15, bold: true });
T("双人 / 三人房间 · 服务器权威 · 断线重连", M + 0.55, 5.13, 4.5, 0.28, { fs: 12, color: C.mut });
s.addShape(P.shapes.ROUNDED_RECTANGLE, { x: M + 5.55, y: 4.85, w: 1.4, h: 0.45, rectRadius: 0.06, fill: { color: C.acc }, line: { color: C.acc, width: 1 } });
T("进入联机 →", M + 5.55, 4.85, 1.4, 0.45, { align: "center", fs: 12, color: "FFFFFF", bold: true });
arrow(M + 7.0, 5.07, 8.9, 5.07);
// Future 占位
wire(M + 0.3, 5.7, 6.9, 0.8, { dash: true, stroke: C.fut, fill: C.futf });
chip("fut", M + 0.5, 5.85);
T("最近对局 / 继续对局 —— 依赖持久化，仅占位不实现", M + 1.45, 5.85, 5.6, 0.5, { fs: 12, color: C.mut });
// 右侧说明
T("设计要点", 8.9, 1.4, 3.9, 0.35, { fs: 15, bold: true });
[
  "本地双击即玩：不设中间选择页，首页即本地模式选择",
  "联机收敛为一个入口：进入后先选 双人 / 三人",
  "底部导航三 Tab 与移动端同构，PC 同布局",
  "顶部不再出现模式切换按钮（移出游戏页）",
  "Future 区只画虚线，不写实现承诺",
].forEach((t, i) => T("· " + t, 8.9, 1.85 + i * 0.62, 3.95, 0.6, { fs: 12.5, color: C.txt }));

/* ============ S6 二级：联机模式选择 ============ */
newSlide(); foot();
hdr("二级页面 · 联机", "联机层是通用能力：模式只决定用哪个 GameMode");
pageFrame(M, 1.3, 7.6, 5.7, "/online", "联机", "联机");
T("选择联机模式", M + 0.3, 1.95, 4, 0.4, { fs: 16, bold: true });
wire(M + 0.3, 2.5, 3.35, 2.0, { fill: "FFFFFF", wd: 1.75 });
T("双人联机", M + 0.55, 2.7, 2.2, 0.4, { fs: 17, bold: true });
chip("fut", M + 0.55, 3.18, { label: "入口预留 · Future" });
T("复用 2P GameMode 与既有规则", M + 0.55, 3.55, 2.9, 0.3, { fs: 12, color: C.mut });
T("同一房间 / 会话 / 超时 / 重连能力", M + 0.55, 3.85, 2.9, 0.3, { fs: 12, color: C.mut });
T("仅 2 个座位，开局条件 = 2 人", M + 0.55, 4.15, 2.9, 0.3, { fs: 12, color: C.mut });
wire(M + 3.85, 2.5, 3.35, 2.0, { fill: "FFFFFF", wd: 1.75 });
T("三人联机", M + 4.1, 2.7, 2.2, 0.4, { fs: 17, bold: true });
chip("have", M + 4.1, 3.18);
T("三阵营 · 渐进绑定 · 淘汰留子", M + 4.1, 3.55, 2.9, 0.3, { fs: 12, color: C.mut });
T("现已可完整对局（Stage 2–7）", M + 4.1, 3.85, 2.9, 0.3, { fs: 12, color: C.mut });
s.addShape(P.shapes.ROUNDED_RECTANGLE, { x: M + 4.1, y: 4.2, w: 1.3, h: 0.36, rectRadius: 0.06, fill: { color: C.pri }, line: { color: C.pri, width: 1 } });
T("进入 →", M + 4.1, 4.2, 1.3, 0.36, { align: "center", fs: 12, color: "FFFFFF", bold: true });
arrow(M + 7.0, 3.5, 8.9, 3.5);
T("架构说明", 8.9, 1.4, 3.9, 0.35, { fs: 15, bold: true });
[
  "服务端 GameRoom 的 seatIds 本就参数化（2/3 座位均支持）",
  "UI 模式选择 → 决定创建房间的 GameMode",
  "WebSocketGameSession / 协议 / 重连全部复用",
  "本阶段不为 2P 联机写实现，只保留正式入口",
  "双人联机卡标注 Future：防误点、明示未开放",
].forEach((t, i) => T("· " + t, 8.9, 1.85 + i * 0.62, 3.95, 0.6, { fs: 12.5 }));

/* ============ S7 三级：联机房间页 ============ */
newSlide(); foot();
hdr("三级页面 · 联机房间", "现有 ConnectionPanel 的正式化改造");
pageFrame(M, 1.3, 7.6, 5.7, "/online/room?mode=3p", "房间 room-1", "联机");
// 左：加入表单（现有）
wire(M + 0.3, 2.4, 3.35, 3.1, { fill: "FFFFFF" });
T("加入房间", M + 0.5, 2.55, 2, 0.35, { fs: 14, bold: true }); chip("mod", M + 2.5, 2.6);
T("服务器地址", M + 0.5, 3.0, 2.9, 0.26, { fs: 12, color: C.mut });
wire(M + 0.5, 3.28, 2.95, 0.4, { fill: "FFFFFF" }); T("ws://localhost:8787", M + 0.62, 3.28, 2.7, 0.4, { fs: 12 });
T("（默认值可来自 设置-联机）", M + 0.5, 3.72, 2.9, 0.26, { fs: 12, color: C.mut });
T("房间 ID", M + 0.5, 4.05, 2.9, 0.26, { fs: 12, color: C.mut });
wire(M + 0.5, 4.33, 2.95, 0.4, { fill: "FFFFFF" }); T("room-1", M + 0.62, 4.33, 2.7, 0.4, { fs: 12 });
s.addShape(P.shapes.ROUNDED_RECTANGLE, { x: M + 0.5, y: 4.9, w: 2.95, h: 0.42, rectRadius: 0.06, fill: { color: C.pri }, line: { color: C.pri, width: 1 } });
T("加入房间（不存在即创建）", M + 0.5, 4.9, 2.95, 0.42, { align: "center", fs: 12, color: "FFFFFF", bold: true });
T("检测到本机重连令牌 → 显示“恢复座位”", M + 0.5, 5.05, 3.05, 0.5, { fs: 12, color: C.acc, valign: "bottom" });
// 右：座位列表
wire(M + 3.85, 2.4, 3.35, 3.1, { fill: "FFFFFF" });
T("当前房间玩家", M + 4.05, 2.55, 2.2, 0.35, { fs: 14, bold: true });
[["玩家 A", "已连接 · 阵营待定", true], ["玩家 B", "等待加入", false], ["玩家 C", "等待加入", false]].forEach(([n, stc, on], i) => {
  wire(M + 4.05, 3.0 + i * 0.62, 2.95, 0.5, { fill: on ? C.wf : "FFFFFF", stroke: on ? C.wfs : C.fut, dash: !on });
  T(n, M + 4.2, 3.0 + i * 0.62, 1.2, 0.5, { fs: 12, bold: true });
  T(stc, M + 5.4, 3.0 + i * 0.62, 1.55, 0.5, { fs: 12, color: on ? C.txt : C.fut });
});
T("2/3 · 满员自动开局 [已有]", M + 4.05, 4.95, 3.1, 0.3, { fs: 12, color: C.mut });
s.addShape(P.shapes.ROUNDED_RECTANGLE, { x: M + 4.05, y: 5.25, w: 1.2, h: 0.34, rectRadius: 0.06, fill: { color: "FFFFFF" }, line: { color: C.mut, width: 1 } });
T("退出房间", M + 4.05, 5.25, 1.2, 0.34, { align: "center", fs: 12, color: C.mut });
// Future
wire(M + 0.3, 5.75, 6.9, 0.75, { dash: true, stroke: C.fut, fill: C.futf });
chip("fut", M + 0.5, 5.9);
T("好友房 · 房间密码 · 观战席位 · 快速匹配 —— 依赖账号/匹配系统，仅占位", M + 1.45, 5.9, 5.7, 0.5, { fs: 12, color: C.mut });
// 右侧说明
T("要点", 8.9, 1.4, 3.9, 0.35, { fs: 15, bold: true });
[
  "身份由服务器分配（A/B/C），客户端不可自选 —— 维持安全边界",
  "重连令牌保存在本机；断线刷新后凭令牌恢复座位",
  "2P 房间复用本页，仅座位数为 2",
  "“创建房间”= 输入不存在的房间 ID，无需独立流程",
].forEach((t, i) => T("· " + t, 8.9, 1.85 + i * 0.72, 3.95, 0.7, { fs: 12.5 }));

/* ============ S8 GamePage 整体布局（PC） ============ */
newSlide(); foot();
hdr("GamePage · 整体布局（PC）", "从“一屏堆叠”到六分区；现有组件全部复用");
const gp = { x: M, y: 1.32, w: 8.4, h: 5.68 };
pageFrame(gp.x, gp.y, gp.w, gp.h, "/game/3p-online", "GamePage", null);
// Header
wire(gp.x + 0.15, gp.y + 0.55, gp.w - 0.3, 0.5, { fill: "FFFFFF", wd: 1.5 });
T("← 返回    模式·房间 chip（联机时）    连接状态 ●    ⚙ 设置", gp.x + 0.3, gp.y + 0.55, gp.w - 0.6, 0.5, { fs: 12, color: C.mut });
T("Header [改造：吸收 StatusBar 的模式/联机信息]", gp.x + gp.w - 3.0, gp.y + 0.62, 2.85, 0.35, { fs: 12, color: C.acc, align: "right" });
// Players
wire(gp.x + 0.15, gp.y + 1.18, gp.w - 0.3, 0.72, { fill: "FFFFFF" });
["玩家A", "玩家B", "玩家C"].forEach((n, i) => {
  const px = gp.x + 0.3 + i * 2.65;
  wire(px, gp.y + 1.3, 2.4, 0.48, { fill: i === 1 ? "F9E9CC" : C.wf, stroke: i === 1 ? C.acc : C.wfs, wd: i === 1 ? 2 : 1.25 });
  T(`${n} · 阵营${i === 1 ? " ●当前" : ""}`, px + 0.12, gp.y + 1.3, 2.2, 0.48, { fs: 12, bold: i === 1 });
});
T("Players [已有组件]", gp.x + gp.w - 2.2, gp.y + 1.75, 2.05, 0.3, { fs: 12, color: C.acc, align: "right" });
// Board
wire(gp.x + 0.15, gp.y + 2.05, 5.3, 3.45, { fill: "FFFFFF" });
boardGrid(gp.x + 0.55, gp.y + 2.35, 0.55, 0.55, 8, 4);
T("Board [已有 BoardView · 棋盘为视觉主体]", gp.x + 0.3, gp.y + 5.12, 4.9, 0.3, { fs: 12, color: C.acc });
// GameStatus 右列
wire(gp.x + 5.6, gp.y + 2.05, 2.55, 3.45, { fill: "FFFFFF" });
T("GameStatus", gp.x + 5.75, gp.y + 2.15, 2.2, 0.3, { fs: 13, bold: true });
T("当前行动：玩家B", gp.x + 5.75, gp.y + 2.5, 2.3, 0.3, { fs: 13, bold: true, color: C.acc });
T("第 12 手", gp.x + 5.75, gp.y + 2.85, 2.2, 0.28, { fs: 12 });
T("操作提示：轮到你翻棋", gp.x + 5.75, gp.y + 3.2, 2.3, 0.28, { fs: 12 });
T("未吃子 ▓▓▓░ 12/40", gp.x + 5.75, gp.y + 3.55, 2.3, 0.28, { fs: 12 });
T("重复   ▓░░░ 2/5", gp.x + 5.75, gp.y + 3.85, 2.3, 0.28, { fs: 12 });
T("[已有 DrawProgress 迁入]\n[StatusBar 拆分至此]", gp.x + 5.75, gp.y + 4.25, 2.3, 0.6, { fs: 12, color: C.acc });
wire(gp.x + 5.75, gp.y + 4.9, 2.25, 0.5, { dash: true, stroke: C.fut });
T("调试面板（默认折叠）", gp.x + 5.85, gp.y + 4.9, 2.1, 0.5, { fs: 12, color: C.fut, align: "center" });
// Toast 位置标注
T("Toast 区（顶部居中，短暂自动消失）", gp.x + 1.4, gp.y + 0.62, 3.6, 0.35, { fs: 12, color: C.mut, align: "center" });
// 右侧说明
T("分区原则", 9.15, 1.4, 3.7, 0.35, { fs: 15, bold: true });
[
  "Header：返回 / 模式·房间 / 连接状态 / 设置入口",
  "Players：只放公开状态（座位·阵营·淘汰·当前）",
  "Board：视觉主体，联机时同样居中",
  "GameStatus：行动方·手数·提示·和棋进度",
  "Toast/Overlay：见下一页体系规范",
  "调试信息退出正式 UI（默认折叠，见后页）",
].forEach((t, i) => T("· " + t, 9.15, 1.85 + i * 0.68, 3.75, 0.62, { fs: 12.5 }));
s.addNotes("映射：BoardView/PlayerPanel/EliminationNotices/GameResultOverlay 直接复用；StatusBar 拆分为 Header（模式/联机信息）+ GameStatus（行动方/提示）；DrawProgress 迁入 GameStatus 并改为读取当前 mode 的阈值。");

/* ============ S9 玩家信息区细则 ============ */
newSlide(); foot();
hdr("GamePage · 玩家信息区", "PlayerPanel 卡片解剖：只展示公开状态");
const cards = [
  { n: "玩家 A", cur: false, out: false, off: false },
  { n: "玩家 B", cur: true, out: false, off: false },
  { n: "玩家 C", cur: false, out: true, off: false },
];
cards.forEach((cd, i) => {
  const x = M + i * 4.2, y = 1.45;
  wire(x, y, 3.9, 1.9, { fill: "FFFFFF", wd: cd.cur ? 2.25 : 1.25, stroke: cd.cur ? C.acc : C.wfs });
  T(cd.n, x + 0.2, y + 0.12, 1.6, 0.35, { fs: 15, bold: true, strike: cd.out });
  if (cd.cur) chip("mod", x + 2.6, y + 0.14, { label: "当前行动" });
  T("阵营：将帅兵卒阵营", x + 0.2, y + 0.62, 3.4, 0.3, { fs: 12.5 });
  T("状态：" + (cd.out ? "已淘汰（划线 + 灰显）" : "对局中"), x + 0.2, y + 0.95, 3.4, 0.3, { fs: 12.5, color: cd.out ? C.fut : C.txt, strike: cd.out });
  wire(x + 0.2, y + 1.32, 3.5, 0.42, { dash: true, stroke: C.fut, fill: C.futf });
  T("Future：剩余棋子数（可由公开盘面推导）", x + 0.32, y + 1.32, 3.3, 0.42, { fs: 12, color: C.fut });
});
// 字段来源
wire(M, 3.75, 6.1, 3.0, { fill: "FFFFFF" });
T("数据来源（全部为服务器权威公开字段）", M + 0.2, 3.9, 5.6, 0.32, { fs: 14, bold: true });
[
  "players[].factionId —— 阵营绑定后公开",
  "players[].eliminated —— 淘汰标记",
  "players[].connected（联机 roomStatus）—— 离线角标",
  "currentPlayerId —— 当前行动高亮",
  "未翻开棋子的一切信息：不出现（公共棋盘冻结设计）",
].forEach((t, i) => T("· " + t, M + 0.2, 4.3 + i * 0.46, 5.7, 0.4, { fs: 12.5 }));
// 联机离线角标
wire(7.0, 3.75, 5.83, 3.0, { fill: "FFFFFF" });
T("联机补充态", 7.2, 3.9, 5.4, 0.32, { fs: 14, bold: true });
T("“玩家 B（离线）”小角标：来自 roomStatus.players[].connected；断线玩家不淘汰、计时继续 —— 与服务器规则一致，UI 只呈现。", 7.2, 4.3, 5.5, 0.9, { fs: 12.5 });
T("淘汰展示同时出现在：玩家卡（划线）+ Toast（一次性原因说明）+ 记录于对局信息，三者共用同一事件，不重复弹窗。", 7.2, 5.35, 5.5, 0.9, { fs: 12.5, color: C.mut });

/* ============ S10 游戏状态区 / 操作提示 ============ */
newSlide(); foot();
hdr("GamePage · 游戏状态区", "GameStatus：行动方、手数、上下文提示、和棋进度");
wire(M, 1.4, 6.0, 3.4, { fill: "FFFFFF", wd: 1.5 });
T("当前行动", M + 0.25, 1.6, 2, 0.3, { fs: 12, color: C.mut });
T("玩家 B", M + 0.25, 1.9, 3, 0.6, { fs: 26, bold: true, color: C.acc });
T("将帅兵卒阵营 · 第 12 手", M + 0.25, 2.55, 4, 0.3, { fs: 12.5 });
T("操作提示（按上下文切换）", M + 0.25, 2.98, 4, 0.3, { fs: 12, color: C.mut });
wire(M + 0.25, 3.3, 5.5, 0.55, { fill: C.wf });
T("“轮到你翻棋” / “选中棋子后点击目标格” / “等待其他玩家行动”", M + 0.4, 3.3, 5.25, 0.55, { fs: 12 });
// 和棋进度
wire(M, 5.0, 6.0, 1.9, { fill: "FFFFFF" });
T("和棋进度", M + 0.25, 5.12, 2.5, 0.3, { fs: 14, bold: true });
s.addShape(P.shapes.ROUNDED_RECTANGLE, { x: M + 0.25, y: 5.55, w: 4.4, h: 0.3, rectRadius: 0.15, fill: { color: C.wf }, line: { color: C.grid, width: 0.75 } });
s.addShape(P.shapes.ROUNDED_RECTANGLE, { x: M + 0.25, y: 5.55, w: 1.32, h: 0.3, rectRadius: 0.15, fill: { color: C.acc }, line: { color: C.acc, width: 0.75 } });
T("连续未吃子 12 / 40", M + 4.8, 5.55, 1.6, 0.3, { fs: 12 });
s.addShape(P.shapes.ROUNDED_RECTANGLE, { x: M + 0.25, y: 6.05, w: 4.4, h: 0.3, rectRadius: 0.15, fill: { color: C.wf }, line: { color: C.grid, width: 0.75 } });
s.addShape(P.shapes.ROUNDED_RECTANGLE, { x: M + 0.25, y: 6.05, w: 0.44, h: 0.3, rectRadius: 0.15, fill: { color: C.pri }, line: { color: C.pri, width: 0.75 } });
T("重复局面 2 / 5", M + 4.8, 6.05, 1.6, 0.3, { fs: 12 });
// 右侧要点
T("要点", 7.0, 1.4, 5.8, 0.35, { fs: 15, bold: true });
[
  "进度阈值读取当前 GameMode 配置（修复现有从 2P 常量硬编码读取的问题）",
  "操作提示按状态机切换：你翻棋 / 你选择目标 / 等待对手 / 强制翻棋（无可走子时）",
  "强制翻棋提示：有隐藏棋子且无合法走吃 → “没有可移动的棋子，请翻开一枚”",
  "联机时状态区并入回合倒计时占位（倒计时只是 UI，权威在服务器）",
].forEach((t, i) => T("· " + t, 7.0, 1.9 + i * 0.85, 5.85, 0.8, { fs: 12.5 }));

/* ============ S11 Overlay / Toast 体系 ============ */
newSlide(); foot();
hdr("GamePage · Overlay / Toast 体系", "两条通知通道：短暂 Toast 与模态 Overlay");
// Toast 列
wire(M, 1.4, 6.0, 5.4, { fill: "FFFFFF" });
T("Toast（顶部居中 · 短暂 · 不阻塞操作）", M + 0.25, 1.55, 5.5, 0.35, { fs: 14, bold: true });
const toasts = [
  ["⚠ 玩家A 无合法行动，已判负并淘汰", "已有 EliminationNotices"],
  ["⏱ 玩家A 操作超时，已判负并淘汰", "已有（reason=timeout）"],
  ["还没轮到你行动", "新增：替代错误码直出"],
  ["该动作不符合规则", "新增：illegalAction 用户化"],
  ["连接已断开，正在重连…", "新增"],
  ["已恢复座位 玩家A", "新增：重连成功"],
];
toasts.forEach(([t, tag], i) => {
  wire(M + 0.25, 2.0 + i * 0.78, 5.5, 0.6, { fill: C.wf });
  T(t, M + 0.4, 2.0 + i * 0.78, 3.9, 0.6, { fs: 12.5, bold: true });
  T(tag, M + 4.1, 2.0 + i * 0.78, 1.6, 0.6, { fs: 12, color: C.acc, align: "right" });
});
// Overlay 列
wire(7.0, 1.4, 5.83, 5.4, { fill: "FFFFFF" });
T("Overlay（模态 · 终局/连接重大事件）", 7.25, 1.55, 5.3, 0.35, { fs: 14, bold: true });
const overs = [
  ["胜利（阵营判据）：“红色棋子阵营获胜”", "已有 GameResultOverlay"],
  ["胜利（最后活跃玩家）：“玩家C获胜（黑色…）”", "已有 winnerPlayerId 支持"],
  ["和棋：“重复局面达 5 次 / 连续 40 步未吃子”", "已有"],
  ["断线卡片：连接已断开 + [重连] [返回]", "已有 GameView 断线态"],
  ["Future：复盘入口、举报 —— 仅占位", "Future"],
];
overs.forEach(([t, tag], i) => {
  wire(7.25, 2.0 + i * 0.82, 5.35, 0.66, { fill: C.wf, dash: tag === "Future" });
  T(t, 7.4, 2.0 + i * 0.82, 3.9, 0.66, { fs: 12.5, bold: tag !== "Future" });
  T(tag, 11.0, 2.0 + i * 0.82, 1.5, 0.66, { fs: 12, color: tag === "Future" ? C.fut : C.acc, align: "right" });
});
T("层级规范：Toast < Overlay < 系统弹窗；Toast 3–4s 自动消失；Overlay 必须给出“返回 / 再来一局”出口；不遮挡棋盘超过必要时长。", M, 6.95, 12.3, 0.35, { fs: 12.5, bold: true, color: C.pri });

/* ============ S12 用户文案 vs 调试信息 ============ */
newSlide(); foot();
hdr("信息分层 · 用户文案与调试", "正式 UI 说人话；错误码进调试面板 / console");
const maps = [
  ["notCurrentPlayer", "还没轮到你行动"],
  ["illegalAction", "这个动作不符合规则"],
  ["playerEliminated", "你已被淘汰，无法继续操作"],
  ["gameOver", "对局已结束"],
  ["roomClosed", "房间已满或已开局"],
  ["invalidToken", "重连失败，请重新加入房间"],
];
const tbl2 = [["服务器拒绝码（调试）", "正式 UI 文案（用户可见）"], ...maps];
s.addTable(tbl2.map((r, i) => r.map((c, j) => ({
  text: c, options: i === 0
    ? { fill: { color: C.pri }, color: "FFFFFF", bold: true, fontSize: 13 }
    : { fontSize: 12.5, fontFace: "Consolas", color: j === 0 ? C.mut : C.txt, bold: j === 1, fill: { color: i % 2 ? "FBF9F4" : "FFFFFF" } },
}))), { x: M, y: 1.4, w: 6.4, colW: [3.2, 3.2], border: { pt: 0.75, color: C.grid }, rowH: 0.5, fontFace: F, valign: "middle", margin: 0.06 });
// Debug panel
wire(7.3, 1.4, 5.5, 4.4, { fill: "FFFFFF", dash: true, stroke: C.fut });
T("DebugPanel [新建 · 仅开发模式可见]", 7.5, 1.55, 5.1, 0.32, { fs: 14, bold: true, color: C.fut });
[
  "开发模式开关（localStorage / URL ?debug=1）",
  "最近一次拒绝：code + reason 原文",
  "连接事件日志：open / state / rejected / eliminated",
  "当前权威状态 JSON 查看",
  "服务器地址 / 房间 / 本机令牌",
].forEach((t, i) => T("· " + t, 7.5, 2.0 + i * 0.52, 5.1, 0.45, { fs: 12.5, color: C.mut }));
T("现有 online.lastError 的原文输出移入此处；正式 UI 只显示用户文案。调试能力不删除。", 7.5, 4.9, 5.1, 0.8, { fs: 12.5, bold: true });
T("所有拒绝事件同时写入 console（开发与正式一致），便于联机排障。", M, 6.3, 6.4, 0.6, { fs: 12.5, color: C.mut });

/* ============ S13 设置页 ============ */
newSlide(); foot();
hdr("一级页面 · 设置", "五分组信息架构；实装项与占位项分明");
pageFrame(M, 1.3, 7.6, 5.7, "/settings", "设置", "设置");
const groups = [
  ["游戏", [["操作提示开关", "new"], ["动画开关", "fut"], ["更多变体 / 自定义规则", "fut"]]],
  ["音效", [["音效开关", "new"], ["音量", "new"]]],
  ["外观", [["主题", "fut"], ["棋盘 / 棋子样式", "fut"]]],
  ["联机", [["默认服务器地址", "new"], ["重连令牌管理", "fut"]]],
  ["关于", [["版本 v0.3.0-ws-client", "new"], ["项目信息", "new"]]],
];
groups.forEach(([g, items], gi) => {
  const gx = M + 0.3 + (gi % 2) * 3.65, gy = 1.95 + Math.floor(gi / 2) * 1.72;
  wire(gx, gy, 3.4, 1.55, { fill: "FFFFFF" });
  T(g, gx + 0.18, gy + 0.1, 1.4, 0.32, { fs: 14, bold: true });
  items.forEach(([it, k], ii) => {
    T(it, gx + 0.18, gy + 0.5 + ii * 0.34, 2.3, 0.3, { fs: 12, color: k === "fut" ? C.fut : C.txt });
    chip(k, gx + 2.55, gy + 0.5 + ii * 0.32);
  });
});
wire(M + 3.95, 5.4, 3.4, 1.4, { dash: true, stroke: C.fut, fill: C.futf });
chip("fut", M + 4.15, 5.55);
T("账号 / 用户资料 —— 依赖账号体系，本产品阶段明确不实现", M + 5.05, 5.55, 2.25, 1.0, { fs: 12, color: C.fut });
// 右说明
T("说明", 8.9, 1.4, 3.9, 0.35, { fs: 15, bold: true });
[
  "音效开关/音量：soundManager 已具备，仅缺 UI",
  "默认服务器：喂给房间页表单默认值",
  "外观项：资源层 registry 已就绪，换肤只改资源",
  "设置持久化用 localStorage，不引入数据库",
  "所有 Future 项仅呈现灰显占位，不可点",
].forEach((t, i) => T("· " + t, 8.9, 1.85 + i * 0.72, 3.95, 0.7, { fs: 12.5 }));

/* ============ S14 PC / 移动横屏 ============ */
newSlide(); foot();
hdr("布局 · PC 与移动横屏", "棋盘优先；信息分区在两端同构");
// PC
wire(M, 1.4, 6.0, 4.0, { fill: "FFFFFF", wd: 1.5 });
T("PC（≥1024px）", M + 0.2, 1.5, 3, 0.3, { fs: 14, bold: true });
wire(M + 0.2, 1.9, 5.6, 0.4); T("Header", M + 0.35, 1.9, 5.3, 0.4, { fs: 12, color: C.mut });
wire(M + 0.2, 2.4, 5.6, 0.55); T("Players 三卡横排", M + 0.35, 2.4, 5.3, 0.55, { fs: 12, color: C.mut });
wire(M + 0.2, 3.05, 3.6, 2.1); boardGrid(M + 0.5, 3.25, 0.36, 0.36, 8, 4);
wire(M + 3.95, 3.05, 1.85, 2.1); T("GameStatus", M + 4.1, 3.15, 1.6, 0.3, { fs: 12, color: C.mut });
T("board = 视觉主体，状态列伴右", M + 0.2, 5.15, 5.6, 0.25, { fs: 12, color: C.mut, align: "center" });
// Mobile landscape
wire(7.0, 1.4, 5.83, 4.0, { fill: "FFFFFF", wd: 1.5 });
T("Mobile 横屏（棋盘优先）", 7.2, 1.5, 4, 0.3, { fs: 14, bold: true });
wire(7.2, 1.9, 5.43, 0.38); T("Header 单行：← · 房间 · ● · ⚙", 7.35, 1.9, 5.1, 0.38, { fs: 12, color: C.mut });
wire(7.2, 2.34, 5.43, 0.34); T("玩家压缩为单行 chips：A ●当前 ｜ B ｜ C 已淘汰", 7.35, 2.34, 5.2, 0.34, { fs: 12, color: C.mut });
wire(7.5, 2.76, 4.8, 1.9, { fill: "FFFFFF", wd: 1.75 });
boardGrid(7.75, 2.92, 0.5, 0.5, 8, 4);
wire(7.2, 4.74, 5.43, 0.4); T("状态条：轮到玩家B · 第12手 · 未吃子 12/40", 7.35, 4.74, 5.2, 0.4, { fs: 12, color: C.mut });
// 原则
T("横屏布局原则", 7.0, 5.6, 5.8, 0.3, { fs: 13, bold: true });
[
  "棋盘格 --cell-size 随视口缩放（现有机制保留），棋盘永远完整可见",
  "玩家信息压缩为单行 chips，不挤压棋盘高度",
  "Toast 顶部出现、自动消失，不遮挡棋盘格",
  "联机状态收进 Header 图标，点击展开详情",
].forEach((t, i) => T("· " + t, 7.0, 5.88 + i * 0.36, 5.85, 0.34, { fs: 12 }));

/* ============ S15 页面跳转关系 ============ */
newSlide(); foot();
hdr("导航 · 页面跳转关系", "点击这里之后去哪");
function node(x, y, w, h, t, st, route) {
  wire(x, y, w, h, { fill: "FFFFFF", wd: st === "game" ? 2 : 1.5 });
  T(t, x + 0.1, y + 0.07, w - 0.2, 0.34, { fs: 13, bold: true, align: "center" });
  if (route) T(route, x + 0.1, y + h - 0.34, w - 0.2, 0.28, { fs: 12, color: C.acc, align: "center" });
}
node(M, 1.6, 2.0, 0.85, "首页", null, "/");
node(M, 3.1, 2.0, 0.85, "GamePage", "game", "本地双人");
node(M, 4.5, 2.0, 0.85, "GamePage", "game", "本地三人");
node(4.6, 1.6, 2.1, 0.85, "联机模式选择", null, "/online");
node(4.6, 3.1, 2.1, 0.85, "房间页 3P", null, "已有");
node(4.6, 4.5, 2.1, 0.85, "房间页 2P", null, "Future");
node(8.2, 2.6, 2.0, 0.85, "GamePage", "game", "联机态");
node(8.2, 4.6, 2.0, 0.85, "断线/重连", null, "恢复座位");
node(11.0, 2.6, 1.8, 0.85, "设置", null, "/settings");
arrow(2.0, 2.45, 1.3, 3.1); // 首页->本地2P
arrow(2.0, 2.45, 1.3, 4.5); // 首页->本地3P（折线近似）
arrow(2.55, 2.45, 4.6, 2.02); // 首页->联机tab
arrow(5.65, 2.45, 5.65, 3.1);
arrow(5.65, 2.45, 5.65, 4.5, { dash: true });
arrow(6.7, 3.5, 8.2, 3.2);
arrow(6.7, 4.9, 8.2, 5.0, { dash: true });
arrow(9.2, 3.45, 9.2, 4.6); arrow(9.2, 4.6, 8.2, 3.3);
arrow(10.2, 3.02, 11.0, 3.02);
T("满员开局", 6.85, 3.35, 1.3, 0.3, { fs: 12, color: C.mut });
T("重连回原座位", 8.6, 4.05, 1.6, 0.5, { fs: 12, color: C.mut });
T("Header ⚙", 10.25, 2.72, 0.8, 0.3, { fs: 12, color: C.mut });
wire(M, 6.1, 12.33, 0.9, { dash: true, stroke: C.fut, fill: C.futf });
T("Future 路径：快速匹配（联机tab）· 观战（房间页席位 → GamePage 观战态）· 对局记录/复盘（首页 Future 区 → 复盘页）", M + 0.2, 6.1, 12.0, 0.9, { fs: 12.5, color: C.fut });
s.addNotes("所有跳转均为前端路由层变化；GamePage 由 modeId + session 类型（local/online）参数化，本地与联机共用同一页面组件。");

/* ============ S16 演进路径 ============ */
newSlide(); foot();
hdr("演进路径 · 从当前 UI 到目标骨架", "三步走：每一步都不破坏现有功能");
const steps = [
  ["Step 1 · 骨架", ["新增首页 + 底部导航 + 设置壳", "游戏页顶部模式按钮移除", "四入口全部可点（2P 联机标注 Future）"], "改动层：App / 新增 2 页壳"],
  ["Step 2 · GamePage 分区", ["Header / Players / Board / GameStatus 分区", "StatusBar 拆分；调试信息入 DebugPanel", "Toast/Overlay 体系归位"], "改动层：GameView 内重排，6 组件全复用"],
  ["Step 3 · 设置与联机 2P", ["音效开关/音量、默认服务器实装", "联机 2P 入口启用（服务端已支持）", "和棋进度读当前 mode 阈值"], "改动层：设置页实装 + seatIds 接线"],
];
steps.forEach(([t, its, note], i) => {
  const x = M + i * 4.25;
  wire(x, 1.4, 3.95, 2.6, { fill: "FFFFFF", wd: 1.75 });
  s.addShape(P.shapes.ROUNDED_RECTANGLE, { x: x + 0.2, y: 1.58, w: 1.7, h: 0.42, rectRadius: 0.06, fill: { color: C.pri }, line: { color: C.pri, width: 1 } });
  T(t, x + 0.2, 1.58, 1.7, 0.42, { align: "center", fs: 13, color: "FFFFFF", bold: true });
  its.forEach((it, j) => T("· " + it, x + 0.2, 2.15 + j * 0.5, 3.6, 0.48, { fs: 12 }));
  T(note, x + 0.2, 3.62, 3.6, 0.3, { fs: 12, color: C.acc, bold: true });
  if (i < 2) arrow(x + 3.98, 2.7, x + 4.22, 2.7);
});
T("Future 功能占位地图", M, 4.35, 6, 0.35, { fs: 15, bold: true });
const fmap = [
  ["好友房 / 邀请 / 房间密码", "联机房间页（虚线区）"],
  ["快速匹配", "联机模式选择页"],
  ["观战", "房间页席位 → GamePage 观战态"],
  ["最近对局 / 继续对局", "首页 Future 区"],
  ["对局记录 / 复盘", "首页入口（复用 actionLog）"],
  ["好友 / 账号 / 资料页", "设置-账号（本阶段明确不做）"],
  ["更多变体 / 自定义规则", "首页（变体入口）+ 设置-游戏"],
];
s.addTable(fmap.map(r => r.map((c, j) => ({ text: c, options: { fontSize: 12, fontFace: F, color: C.txt, bold: j === 0 } }))),
  { x: M, y: 4.75, w: 12.33, colW: [4.2, 8.13], border: { pt: 0.75, color: C.grid }, rowH: 0.32, valign: "middle", margin: 0.05 });
T("验收标准：只看本架构即可回答“新功能放哪个页面”；本原型即为下一阶段 UI 实现的施工依据。", M, 6.9, 12.3, 0.35, { fs: 13, bold: true, color: C.pri });

P.writeFile({ fileName: "../DarkChess-UI-IA-LowFi-Prototype-v0.1.pptx" }).then(() => console.log("deck written"));
