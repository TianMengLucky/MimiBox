/** 前端插件运行时：加载插件清单 → 注入 bundle 脚本 → 经 cordis 上下文启动插件。
 *
 * 每个窗口（主窗口、弹幕独立窗）都会执行一遍：脚本经 mbplugin:// 协议从
 * 插件目录读取，注册表随窗口独立。插件加载失败只记录日志，不阻断其余插件。
 */

import { Context } from "@cordisjs/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { tauriInvoke, hasTauri } from "../lib/tauriInvoke";
import { createPluginContext } from "./plugin-api";
import { featureRegistry } from "./registry";
import type { MbPluginDef } from "./plugin-api";
import type { MbPluginManifest } from "./types";
import { hostRequire, installSharedModules } from "./shared";

/** 运行时状态：loading（清单/脚本加载中）/ ready（全部插件处理完毕） */
type RuntimeState = "loading" | "ready";

let state: RuntimeState = "loading";
/** 本窗口的 cordis 根上下文（热加载新插件时复用） */
let rootCtx: Context | null = null;
/** 本窗口已处理过前端加载的插件 id（热同步时跳过，避免重复注册） */
const processedIds = new Set<string>();
/** 已加载插件的前端 Fiber（热卸载时 dispose） */
const pluginFibers = new Map<string, { dispose?: () => unknown }>();
const stateListeners = new Set<() => void>();

function setState(next: RuntimeState) {
  state = next;
  stateListeners.forEach((listener) => listener());
}

/** 供 useSyncExternalStore 读取/订阅运行时状态 */
export const pluginRuntime = {
  getState: (): RuntimeState => state,
  subscribe(listener: () => void): () => void {
    stateListeners.add(listener);
    return () => {
      stateListeners.delete(listener);
    };
  },
};

/** 向文档注入插件 bundle 脚本（mbplugin:// 协议，宿主 Rust 端提供文件） */
function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error(`插件脚本加载失败: ${src}（先运行 pnpm build:plugins）`));
    document.head.appendChild(script);
  });
}

/** 读取插件清单；非 Tauri 环境（浏览器预览）返回空列表 */
async function listPlugins(): Promise<MbPluginManifest[]> {
  if (!hasTauri) return [];
  try {
    return await tauriInvoke<MbPluginManifest[]>("plugin_list");
  } catch (err) {
    console.error("读取插件清单失败", err);
    return [];
  }
}

/** 加载单个插件前端：注入脚本 → 调用 CJS 工厂 → cordis 启动插件 */
async function loadPlugin(ctx: Context, manifest: MbPluginManifest): Promise<void> {
  const { id } = manifest;
  if (!manifest.entry?.frontend) return;

  // Windows/Android 的自定义协议要经 http://mbplugin.localhost 访问，
  // convertFileSrc 按平台生成正确 URL（路径整体百分号编码，宿主端解码）
  const url = convertFileSrc(`${id}/${manifest.entry.frontend}`, "mbplugin");
  await injectScript(url);
  const factory = window.__mb_plugins?.[id];
  if (!factory) {
    throw new Error("bundle 未注册插件工厂（__mb_plugins）");
  }
  const module = { exports: {} as Record<string, unknown> };
  factory(hostRequire, module, module.exports);
  const def = module.exports.default as MbPluginDef | undefined;
  if (!def || typeof def.apply !== "function") {
    throw new Error("bundle 缺少 default 导出的 defineMbPlugin 定义");
  }

  // cordis 管插件生命周期；apply 内通过 createPluginContext 拿宿主能力
  const fiber = ctx.plugin({
    name: `mb-plugin:${id}`,
    apply: (cordisCtx) => {
      void cordisCtx;
      return def.apply(createPluginContext(manifest));
    },
  });
  pluginFibers.set(id, fiber as unknown as { dispose?: () => unknown });
}

/** 加载并登记单个插件：跳过失败与已处理的插件 */
async function loadSingle(ctx: Context, manifest: MbPluginManifest): Promise<void> {
  if (manifest.state === "Failed" || processedIds.has(manifest.id)) return;
  try {
    await loadPlugin(ctx, manifest);
    processedIds.add(manifest.id);
  } catch (err) {
    // 加载失败的插件不计入 processedIds，后续热加载事件到来时可重试
    console.error(`插件「${manifest.id}」前端加载失败`, err);
  }
}

/** 与宿主清单同步：加载新增插件、移除已删除/卸载的插件
 * （宿主 plugin_reload / plugin_remove 后广播 plugins-changed 触发） */
async function syncPlugins(): Promise<void> {
  if (!rootCtx || state !== "ready" || !hasTauri) return;
  const manifests = await listPlugins();
  const active = new Set(
    manifests.filter((m) => m.state !== "Failed").map((m) => m.id),
  );
  // 移除已删除/卸载的插件：dispose 前端 Fiber 并清理功能注册表
  for (const id of [...processedIds]) {
    if (active.has(id)) continue;
    processedIds.delete(id);
    const fiber = pluginFibers.get(id);
    pluginFibers.delete(id);
    try {
      await fiber?.dispose?.();
    } catch (err) {
      console.warn(`插件「${id}」前端卸载失败`, err);
    }
    featureRegistry.remove(id);
  }
  // 加载新增插件
  for (const manifest of manifests) {
    await loadSingle(rootCtx, manifest);
  }
}

/** 启动插件运行时（main.tsx 调用一次；不阻塞首屏渲染） */
export async function startPluginRuntime(): Promise<void> {
  if (state === "ready") return;
  installSharedModules();

  try {
    const manifests = await listPlugins();
    rootCtx = new Context();
    for (const manifest of manifests) {
      await loadSingle(rootCtx, manifest);
    }
    if (hasTauri) {
      await listen("plugins-changed", () => {
        void syncPlugins();
      });
    }
  } finally {
    setState("ready");
  }
}
