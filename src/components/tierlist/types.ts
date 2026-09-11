/** 夯到拉共享类型与常量（与 src-tauri/src/tierlist/mod.rs 的 TierListData 对应，camelCase） */

/** 拖拽载荷的自定义 MIME 类型，仅应用内部条目拖拽使用 */
export const DRAG_MIME = "application/x-mimibox-tier-item";

/** 固定的五个梯队，名称与底色对齐参考站（acofork tier-list），不可增删改名 */
export const DEFAULT_TIERS: ReadonlyArray<{ name: string; color: string }> = [
  { name: "夯", color: "#e5484d" },
  { name: "顶级", color: "#f08a3c" },
  { name: "人上人", color: "#f2c94c" },
  { name: "NPC", color: "#f5cfa8" },
  { name: "拉", color: "#ffffff" },
];

/** 单个方案内图片总数上限，避免 tierlist.json 无限膨胀 */
export const MAX_ITEMS = 60;

/** 排名条目：图片（压缩后的 PNG data URL）+ 可选名称（文件名去扩展名） */
export interface TierItem {
  id: string;
  name: string;
  image: string;
}

/** 一个梯队：名称 + 底色 + 已归类的条目 */
export interface Tier {
  id: string;
  name: string;
  color: string;
  items: TierItem[];
}

/** 排名方案：梯队列表 + 待排图片池 */
export interface TierListScheme {
  id: string;
  name: string;
  tiers: Tier[];
  pool: TierItem[];
}

/** 保存到 tierlist.json 的完整数据 */
export interface TierListData {
  schemes: TierListScheme[];
  activeSchemeId: string | null;
}
