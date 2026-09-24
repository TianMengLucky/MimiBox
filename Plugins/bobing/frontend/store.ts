/** 博饼数据（bobing.json）读写：经插件上下文走网关调用本插件后端命令 */
import type { MbPluginContext } from "mb-host";
import { createSchemeStore } from "@components/schemeStore";
import type { BobingData } from "./types";

export function createBobingStore(ctx: MbPluginContext) {
  return createSchemeStore<BobingData>({
    file: "bobing.json",
    loadCommand: "bobing_load",
    saveCommand: "bobing_save",
    empty: () => ({ history: [] }),
    invoke: (command, args) => ctx.invoke(command, args),
  });
}
