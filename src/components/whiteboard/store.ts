import { tauriInvoke } from "../../lib/tauriInvoke";
import type { WhiteboardData } from "./types";

/** 白板数据（whiteboard.json）读写；非 Tauri 环境下返回空数据方便浏览器预览 */
export function loadWhiteboardData(): Promise<WhiteboardData> {
  return tauriInvoke("whiteboard_load", undefined, {
    defaultValue: { background: null, items: [] },
  });
}

/** 整体保存白板数据 */
export function saveWhiteboardData(data: WhiteboardData): Promise<void> {
  return tauriInvoke("whiteboard_save", { data });
}
