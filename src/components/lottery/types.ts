/** 抽奖功能共享类型（与 src-tauri/src/lottery/mod.rs 的 LotteryData 对应，camelCase） */

/** 转盘奖品：名称 + 可选图片（压缩后的 PNG data URL） */
export interface LotteryPrize {
  id: string;
  name: string;
  image: string | null;
}

/** 抽奖方案：一组奖品，可新建 / 切换 / 删除 */
export interface LotteryScheme {
  id: string;
  name: string;
  prizes: LotteryPrize[];
}

/** 单条抽奖历史记录 */
export interface LotteryHistoryEntry {
  id: string;
  schemeId: string;
  schemeName: string;
  prizeId: string;
  prizeName: string;
  /** Unix 时间戳（毫秒） */
  time: number;
}

/** 保存到 lottery.json 的完整数据 */
export interface LotteryData {
  schemes: LotteryScheme[];
  activeSchemeId: string | null;
  history: LotteryHistoryEntry[];
}
