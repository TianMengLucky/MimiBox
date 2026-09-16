import { createSchemeStore } from "@components/schemeStore";
import type { PredictionData } from "./types";

/** 赛事预测数据（prediction.json）读写；读取失败降级为空数据 */
const store = createSchemeStore<PredictionData>({
  file: "prediction.json",
  loadCommand: "prediction_load",
  saveCommand: "prediction_save",
  empty: () => ({ schemes: [], activeSchemeId: null }),
});

/** 读取赛事预测数据 */
export const loadPredictionData = store.load;

/** 整体保存赛事预测数据 */
export const savePredictionData = store.save;
