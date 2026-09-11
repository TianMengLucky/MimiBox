import { invoke } from "@tauri-apps/api/core";
import type { TierListData } from "./types";

/** 读取排名数据；不可用（如纯浏览器预览）或失败时降级为空数据 */
export async function loadTierListData(): Promise<TierListData> {
  try {
    return await invoke<TierListData>("tierlist_load");
  } catch (err) {
    console.error("读取排名数据失败", err);
    return { schemes: [], activeSchemeId: null };
  }
}

/** 整体保存排名数据到 tierlist.json */
export function saveTierListData(data: TierListData): Promise<void> {
  return invoke("tierlist_save", { data });
}

/** 保存排名图 PNG 到应用数据目录 exports/，并返回文件路径 */
export function exportTierListImageFile(name: string, dataUrl: string): Promise<string> {
  return invoke("tierlist_export_image", { name, dataUrl });
}
