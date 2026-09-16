import { tauriInvoke } from "../../lib/tauriInvoke";
import { createSchemeStore } from "@components/schemeStore";
import type { TierListData } from "./types";

/** 排名数据（tierlist.json）读写；读取失败降级为空数据 */
const store = createSchemeStore<TierListData>({
  file: "tierlist.json",
  loadCommand: "tierlist_load",
  saveCommand: "tierlist_save",
  empty: () => ({ schemes: [], activeSchemeId: null }),
});

/** 读取排名数据 */
export const loadTierListData = store.load;

/** 整体保存排名数据 */
export const saveTierListData = store.save;

/** 保存排名图 PNG 到应用数据目录 exports/，并返回文件路径 */
export function exportTierListImageFile(name: string, dataUrl: string): Promise<string> {
  return tauriInvoke("tierlist_export_image", { name, dataUrl });
}
