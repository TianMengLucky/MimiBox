/** 抽奖数据（lottery.json）读写：经插件上下文走网关调用本插件后端命令 */
import type { MbPluginContext } from "mb-host";
import { createSchemeStore } from "@components/schemeStore";
import type { LotteryData } from "./types";

export function createLotteryStore(ctx: MbPluginContext) {
  return createSchemeStore<LotteryData>({
    file: "lottery.json",
    loadCommand: "lottery_load",
    saveCommand: "lottery_save",
    empty: () => ({ schemes: [], activeSchemeId: null, history: [] }),
    invoke: (command, args) => ctx.invoke(command, args),
  });
}
