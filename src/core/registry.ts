/** 功能注册表：插件前端 registerFeature 的唯一落点，home/library/通用路由的数据源。 */

import type { ComponentType } from "react";

import type { MbPluginManifest } from "./types";

/** 插件注册的功能入口 */
export interface FeatureEntry {
  manifest: MbPluginManifest;
  /** /feature/<id> 页面组件 */
  component?: ComponentType;
  /** 独立窗口组件（/w/<id> 渲染） */
  windowComponent?: ComponentType;
  /** 卡片注册位置：home 主页 / library 资料库 */
  area: "home" | "library";
}

const entries = new Map<string, FeatureEntry>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version += 1;
  listeners.forEach((listener) => listener());
}

export const featureRegistry = {
  add(entry: FeatureEntry) {
    entries.set(entry.manifest.id, entry);
    emit();
  },

  /** 移除一个已注册功能（插件热卸载/删除时调用） */
  remove(id: string) {
    if (entries.delete(id)) {
      emit();
    }
  },

  get(id: string): FeatureEntry | undefined {
    return entries.get(id);
  },

  /** 列出全部（area 缺省）或指定注册位置的插件 */
  list(area?: "home" | "library"): FeatureEntry[] {
    return [...entries.values()].filter((entry) => !area || entry.area === area);
  },

  /** 供 useSyncExternalStore 订阅 */
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  getVersion: () => version,
};
