import { invoke } from "@tauri-apps/api/core";
import type { LotteryData } from "./types";

/** 读取抽奖数据；不可用（如纯浏览器预览）或失败时降级为空数据 */
export async function loadLotteryData(): Promise<LotteryData> {
  try {
    return await invoke<LotteryData>("lottery_load");
  } catch (err) {
    console.error("读取抽奖数据失败", err);
    return { schemes: [], activeSchemeId: null, history: [] };
  }
}

/** 整体保存抽奖数据到 lottery.json */
export function saveLotteryData(data: LotteryData): Promise<void> {
  return invoke("lottery_save", { data });
}
