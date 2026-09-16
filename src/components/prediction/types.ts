/** 赛事预测共享类型与常量（与 src-tauri/src/prediction/mod.rs 的 PredictionData 对应，camelCase） */

/** 应用内条目拖拽的自定义 MIME 类型，仅选项拖拽使用 */
export const DRAG_MIME = "application/x-mimibox-prediction-entry";

/** 单个方案内选项总数上限，避免 prediction.json 无限膨胀 */
export const MAX_ENTRIES = 60;

/** 节点列（轮次/分组）数量上限，避免节点图无限加宽 */
export const MAX_ROUNDS = 10;

/** 单列节点数量上限 */
export const MAX_NODES_PER_ROUND = 12;

/** 比赛节点固定席位数量（主客两选项） */
export const SLOT_PER_NODE = 2;

/** 预设画布背景色板（CSS 颜色或渐变值；空字符串 = 默认底色） */
export const BACKGROUND_PRESETS: ReadonlyArray<{ label: string; value: string }> = [
  { label: "默认", value: "" },
  { label: "浅粉", value: "#ffe4f0" },
  { label: "樱粉", value: "#f2bfd8" },
  { label: "暗夜", value: "#232438" },
  { label: "薄荷", value: "#e0f2ea" },
  { label: "奶油", value: "#fff4e3" },
  { label: "蓝紫", value: "linear-gradient(135deg, #dfe6ff 0%, #fde7f3 100%)" },
  { label: "日落", value: "linear-gradient(135deg, #ffe9d6 0%, #ffd4e5 100%)" },
];

/** 选项：队伍/选手条目，名称 + 可选图片（压缩后的 PNG data URL） */
export interface PredictionEntry {
  id: string;
  name: string;
  image: string | null;
}

/** 节点上的一个席位：引用选项 + 比分；entryId 为 null 表示空位 */
export interface PredictionSlot {
  entryId: string | null;
  score: string;
}

/** 一个比赛节点：标题（场次/时间）+ 若干席位 */
export interface PredictionNode {
  id: string;
  title: string;
  slots: PredictionSlot[];
}

/** 节点列（轮次/分组）：名称 + 节点列表 */
export interface PredictionRound {
  id: string;
  name: string;
  nodes: PredictionNode[];
}

/** 节点间连线（晋级关系）：source → target，均为节点 id */
export interface PredictionLink {
  id: string;
  source: string;
  target: string;
}

/** 节点手动摆放的坐标（画布左上角原点） */
export interface PredictionPoint {
  x: number;
  y: number;
}

/** 方案背景：纯色/渐变 CSS 值 + 可选背景图（JPEG data URL） */
export interface SchemeBackground {
  color: string;
  image: string | null;
}

/** 预测方案：选项库 + 晋级节点图 */
export interface PredictionScheme {
  id: string;
  name: string;
  entries: PredictionEntry[];
  rounds: PredictionRound[];
  links: PredictionLink[];
  /** 手动拖拽过的节点坐标；缺省节点由前端 dagre 自动布局 */
  positions: Record<string, PredictionPoint>;
  background: SchemeBackground;
}

/** 保存到 prediction.json 的完整数据 */
export interface PredictionData {
  schemes: PredictionScheme[];
  activeSchemeId: string | null;
}

/** 空席位 */
export const emptySlot = (): PredictionSlot => ({ entryId: null, score: "" });

/** 建一个空节点：默认标题 + count 个空席位 */
export const makeNode = (title: string, count = SLOT_PER_NODE): PredictionNode => ({
  id: crypto.randomUUID(),
  title,
  slots: Array.from({ length: count }, emptySlot),
});

/** 默认节点图：两列（第一轮 + 决赛），足够示意、也方便直接改名套用任何赛制 */
export const makeScheme = (name: string): PredictionScheme => ({
  id: crypto.randomUUID(),
  name,
  entries: [],
  links: [],
  positions: {},
  background: { color: "", image: null },
  rounds: [
    {
      id: crypto.randomUUID(),
      name: "第一轮",
      nodes: [makeNode("第 1 场"), makeNode("第 2 场")],
    },
    {
      id: crypto.randomUUID(),
      name: "决赛",
      nodes: [makeNode("决赛")],
    },
  ],
});
