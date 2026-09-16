/** 评分共享类型与常量（与 src-tauri/src/rating/mod.rs 的 RatingData 对应，camelCase） */

/** 评分下限/上限与步进：1-10 分，0.5 一档（允许一位小数） */
export const SCORE_MIN = 1;
export const SCORE_MAX = 10;
export const SCORE_STEP = 0.5;

/** 单个方案内选项总数上限，避免 rating.json 无限膨胀 */
export const MAX_ITEMS = 500;

/** 评分条目：名称 + 评分（null 未评）+ 添加时间（ms 时间戳，用于时间排序） */
export interface RatingItem {
  id: string;
  name: string;
  score: number | null;
  createdAt: number;
}

/** 评分方案：一批待评选项 */
export interface RatingScheme {
  id: string;
  name: string;
  items: RatingItem[];
}

/** 保存到 rating.json 的完整数据 */
export interface RatingData {
  schemes: RatingScheme[];
  activeSchemeId: string | null;
}

/** 排序方式：默认（导入顺序）/ 时间（最近添加在前）/ 评分（高分在前，未评垫底） */
export type RatingSort = "default" | "time" | "score";

/** 评分显示：整数不带小数点，其余保留一位小数 */
export function formatScore(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}
