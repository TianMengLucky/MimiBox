/** 博饼功能共享类型（与 src-tauri/src/bobing/mod.rs 的 BobingData 对应，camelCase） */

/** 彩头等级 id（与 rules.ts 的 BOBING_RANKS 对应，从高到低） */
export type BobingRankId =
  | "jinhua"
  | "wuzi"
  | "zhuangyuan"
  | "duitang"
  | "sanhong"
  | "sijin"
  | "erju"
  | "yixiu"
  | "none";

/** 单次博饼历史记录 */
export interface BobingHistoryEntry {
  id: string;
  /** 六颗骰子的点数（1-6） */
  dice: number[];
  /** 彩头等级 id（前端判定结果） */
  rankId: BobingRankId;
  rankName: string;
  /** Unix 时间戳（毫秒） */
  time: number;
}

/** 保存到 bobing.json 的完整数据 */
export interface BobingData {
  history: BobingHistoryEntry[];
}
