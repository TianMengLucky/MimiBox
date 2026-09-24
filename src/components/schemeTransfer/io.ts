import { pluginInvoke } from "../../lib/tauriInvoke";
import { open, save } from "@tauri-apps/plugin-dialog";

/** 支持方案导入导出的功能标识（与 .miz 包内 miz.json 的 kind 对应） */
export type MizKind = "lottery" | "tierlist" | "prediction" | "rating";

/** .miz 包内 miz.json 的结构；schemes 的具体形状由各功能自行约定 */
export interface MizPayload<T> {
  app: string;
  format: number;
  kind: MizKind;
  exportedAt: number;
  schemes: T[];
}

const MIZ_FILTER = { name: "MimiBox 方案包", extensions: ["miz"] };

/** 把导入的方案合并进现有方案：与现有 id 冲突时重新生成 id，避免覆盖既有数据 */
export function mergeSchemes<T extends { id: string }>(
  existing: T[],
  imported: T[],
): T[] {
  const ids = new Set(existing.map((s) => s.id));
  return imported.map((s) => (ids.has(s.id) ? { ...s, id: crypto.randomUUID() } : s));
}

/**
 * 把选中的方案打包成 .miz：先弹保存对话框，取消则返回 "cancelled"。
 * defaultName 不带扩展名（如方案名），导出成功返回 "saved"。
 */
export async function exportSchemes<T>(
  kind: MizKind,
  schemes: T[],
  defaultName: string,
): Promise<"cancelled" | "saved"> {
  const path = await save({
    defaultPath: `${defaultName}.miz`,
    filters: [MIZ_FILTER],
  });
  if (!path) return "cancelled";
  const payload: MizPayload<T> = {
    app: "mimibox",
    format: 1,
    kind,
    exportedAt: Date.now(),
    schemes,
  };
  await pluginInvoke("scheme-io", "scheme_io_write", { path, payload });
  return "saved";
}

/**
 * 选择 .miz 并读取其中的方案列表；取消选择返回 null。
 * 文件无效或 kind 不匹配时抛错（错误文案已面向用户）。
 */
export async function importSchemes<T>(kind: MizKind): Promise<T[] | null> {
  const path = await open({
    multiple: false,
    filters: [MIZ_FILTER, { name: "所有文件", extensions: ["*"] }],
  });
  if (!path) return null;
  const payload = await pluginInvoke<MizPayload<T>>("scheme-io", "scheme_io_read", { path, kind });
  return payload.schemes;
}
