import { createSchemeStore } from "@components/schemeStore";
import type { BobingData } from "./types";

/** 博饼数据（bobing.json）读写；读取失败降级为空数据 */
const store = createSchemeStore<BobingData>({
  file: "bobing.json",
  loadCommand: "bobing_load",
  saveCommand: "bobing_save",
  empty: () => ({ history: [] }),
});

/** 读取博饼数据 */
export const loadBobingData = store.load;

/** 整体保存博饼数据 */
export const saveBobingData = store.save;
