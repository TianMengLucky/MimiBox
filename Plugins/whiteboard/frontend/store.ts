/** 白板数据（whiteboard.json）读写：经插件上下文走网关调用本插件后端命令 */
import type { MbPluginContext } from "mb-host";
import type { WhiteboardData } from "./types";

export function createWhiteboardStore(ctx: MbPluginContext) {
  return {
    /** 读取白板数据 */
    loadWhiteboardData: (): Promise<WhiteboardData> => ctx.invoke("whiteboard_load"),
    /** 整体保存白板数据 */
    saveWhiteboardData: (data: WhiteboardData): Promise<void> =>
      ctx.invoke("whiteboard_save", { data }),
  };
}

export type WhiteboardStore = ReturnType<typeof createWhiteboardStore>;
