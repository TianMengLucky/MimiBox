import { createSchemeStore } from "@components/schemeStore";
import type { RatingData } from "./types";

/** 评分数据（rating.json）读写；读取失败降级为空数据 */
const store = createSchemeStore<RatingData>({
  file: "rating.json",
  loadCommand: "rating_load",
  saveCommand: "rating_save",
  empty: () => ({ schemes: [], activeSchemeId: null }),
});

/** 读取评分数据 */
export const loadRatingData = store.load;

/** 整体保存评分数据 */
export const saveRatingData = store.save;
