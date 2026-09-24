/** 赛事预测数据（prediction.json）读写：经插件上下文走网关调用本插件后端命令 */
import type { MbPluginContext } from "mb-host";
import { createSchemeStore } from "@components/schemeStore";
import type { PredictionData } from "./types";

export function createPredictionStore(ctx: MbPluginContext) {
  return createSchemeStore<PredictionData>({
    file: "prediction.json",
    loadCommand: "prediction_load",
    saveCommand: "prediction_save",
    empty: () => ({ schemes: [], activeSchemeId: null }),
    invoke: (command, args) => ctx.invoke(command, args),
  });
}
