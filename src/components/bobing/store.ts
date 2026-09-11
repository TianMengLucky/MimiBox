import { invoke } from "@tauri-apps/api/core";
import type { BobingData } from "./types";

/** 读取博饼数据；不可用（如纯浏览器预览）或失败时降级为空数据 */
export async function loadBobingData(): Promise<BobingData> {
  try {
    return await invoke<BobingData>("bobing_load");
  } catch (err) {
    console.error("读取博饼数据失败", err);
    return { history: [] };
  }
}

/** 整体保存博饼数据到 bobing.json */
export function saveBobingData(data: BobingData): Promise<void> {
  return invoke("bobing_save", { data });
}
