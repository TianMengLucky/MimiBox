import { createSchemeStore } from "@components/schemeStore";
import type { LotteryData } from "./types";

/** 抽奖数据（lottery.json）读写；读取失败降级为空数据 */
const store = createSchemeStore<LotteryData>({
  file: "lottery.json",
  loadCommand: "lottery_load",
  saveCommand: "lottery_save",
  empty: () => ({ schemes: [], activeSchemeId: null, history: [] }),
});

/** 读取抽奖数据 */
export const loadLotteryData = store.load;

/** 整体保存抽奖数据 */
export const saveLotteryData = store.save;
