/** 排名数据（tierlist.json）读写与导图命令：经插件上下文走网关调用本插件后端命令 */
import type { MbPluginContext } from "mb-host";
import { createSchemeStore } from "@components/schemeStore";
import type { TierListData } from "./types";

export function createTierListStore(ctx: MbPluginContext) {
  const schemeStore = createSchemeStore<TierListData>({
    file: "tierlist.json",
    loadCommand: "tierlist_load",
    saveCommand: "tierlist_save",
    empty: () => ({ schemes: [], activeSchemeId: null }),
    invoke: (command, args) => ctx.invoke(command, args),
  });

  /** 保存排名图 PNG 到应用数据目录 exports/，并返回文件路径 */
  function exportTierListImageFile(name: string, dataUrl: string): Promise<string> {
    return ctx.invoke("tierlist_export_image", { name, dataUrl });
  }

  return { ...schemeStore, exportTierListImageFile };
}
