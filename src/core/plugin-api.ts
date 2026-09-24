/** 插件前端 API（"mb-host" 共享模块）：插件 bundle 里 defineMbPlugin 的实现。 */

import { listen } from "@tauri-apps/api/event";
import type { ComponentType } from "react";

import { pluginInvoke } from "../lib/tauriInvoke";
import { featureRegistry } from "./registry";
import type { MbPluginManifest } from "./types";

/** registerFeature 的注册内容 */
export interface MbFeatureSpec {
  /** /feature/<id> 页面组件 */
  component?: ComponentType;
  /** 独立窗口组件（配合宿主 createWindow，在 /w/<id> 渲染） */
  windowComponent?: ComponentType;
  /** 卡片注册位置，缺省注册到主页 */
  area?: "home" | "library";
}

/** 插件拿到的宿主上下文 */
export interface MbPluginContext {
  /** 插件 id（宿主注入，与 manifest.id 一致） */
  readonly id: string;
  /** 调用本插件后端命令（对应 Rust 端 Registry 里的命令名） */
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  /** 调用其他插件的命令（如 account、scheme-io） */
  invokePlugin<T>(
    plugin: string,
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T>;
  /** 订阅宿主事件（Tauri 事件桥，如上传进度、弹幕消息）；返回取消函数 */
  listen<T>(event: string, handler: (payload: T) => void): Promise<() => void>;
  /** 注册功能入口（页面组件、可选窗口组件） */
  registerFeature(spec: MbFeatureSpec): void;
}

/** 插件前端定义：bundle 入口 `export default defineMbPlugin({...})` */
export interface MbPluginDef {
  apply: (ctx: MbPluginContext) => void | Promise<void>;
}

/** 插件前端定义帮助函数（仅类型收窄，无运行时行为） */
export function defineMbPlugin(def: MbPluginDef): MbPluginDef {
  return def;
}

/** 由清单构造插件上下文（宿主加载器调用，插件代码不感知） */
export function createPluginContext(manifest: MbPluginManifest): MbPluginContext {
  const listenHost = async <T,>(
    event: string,
    handler: (payload: T) => void,
  ): Promise<() => void> => {
    const unlisten = await listen<unknown>(event, (emitEvent) =>
      handler(emitEvent.payload as T),
    );
    return unlisten;
  };

  return {
    id: manifest.id,
    invoke: (command, args) => pluginInvoke(manifest.id, command, args),
    invokePlugin: (plugin, command, args) => pluginInvoke(plugin, command, args),
    listen: listenHost,
    registerFeature: (spec) => {
      featureRegistry.add({
        manifest,
        area: spec.area ?? "home",
        component: spec.component,
        windowComponent: spec.windowComponent,
      });
    },
  };
}
