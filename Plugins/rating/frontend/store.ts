/** 评分数据（rating.json）读写：经插件上下文走网关调用本插件后端命令 */
import type { MbPluginContext } from "mb-host";
import { createSchemeStore } from "@components/schemeStore";
import type { RatingData } from "./types";

export function createRatingStore(ctx: MbPluginContext) {
  return createSchemeStore<RatingData>({
    file: "rating.json",
    loadCommand: "rating_load",
    saveCommand: "rating_save",
    empty: () => ({ schemes: [], activeSchemeId: null }),
    invoke: (command, args) => ctx.invoke(command, args),
  });
}
