/** 番剧插件前端 API：经插件上下文调用本插件后端命令 */
import { hasTauri, tauriInvoke } from "@lib/tauriInvoke";
import type { MbPluginContext } from "mb-host";
import type { BangumiWeekday } from "./types";

/** 番剧插件前端 API（index.tsx 里用插件上下文构造后传入页面） */
export interface AnimeApi {
  /** 每日放送时间表 */
  calendar(): Promise<BangumiWeekday[]>;
  /** 用系统默认浏览器打开条目页（纯浏览器环境降级 window.open） */
  openItem(url: string): Promise<void>;
}

export function createAnimeApi(ctx: MbPluginContext): AnimeApi {
  return {
    calendar: () => ctx.invoke<BangumiWeekday[]>("bangumi_calendar"),
    // 共享模块表未提供 @tauri-apps/plugin-opener 的 JS 封装（esbuild 亦外置
    // @tauri-apps/*），有 Tauri 时直调其底层命令；入参与 JS 封装 openUrl 一致，
    // https URL 已由 capabilities 的 opener:default 覆盖
    openItem: async (url) => {
      if (hasTauri) {
        await tauriInvoke<void>("plugin:opener|open_url", { url }).catch(() => {});
      } else {
        window.open(url, "_blank");
      }
    },
  };
}
