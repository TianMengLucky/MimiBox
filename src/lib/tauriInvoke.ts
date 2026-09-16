import { invoke } from "@tauri-apps/api/core";
import { router } from "../router";

/** 是否运行在 Tauri 应用内（打包后的浏览器页面 / 纯浏览器预览为 false） */
export const hasTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** 非 Tauri 环境下调用命令时抛出，页面可据此展示友好提示 */
export class TauriRequiredError extends Error {
  constructor(command: string) {
    super("此功能需要在 MimiBox 应用内使用");
    this.name = "TauriRequiredError";
    this.command = command;
  }
  command: string;
}

let navigating = false;

/** 跳转到“需要在应用内打开”提示页（避免重复跳转与循环） */
function navigateToTauriRequired() {
  if (navigating || router.state.location.pathname === "/tauri-required") {
    return;
  }
  navigating = true;
  void router
    .navigate({ to: "/tauri-required" })
    .catch((err) => console.error("跳转提示页失败", err))
    .finally(() => {
      navigating = false;
    });
}

/**
 * 所有前端 invoke 的统一入口：
 * - 应用内：正常调用，失败时记录日志并继续抛出（由页面展示错误）；
 * - 非 Tauri 环境 + 开发模式 + 提供了 defaultValue：返回默认值，方便在浏览器里预览 UI；
 * - 其余非 Tauri 情况：跳转 /tauri-required 提示页，并抛出 TauriRequiredError。
 */
export async function tauriInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
  options: { defaultValue?: T } = {},
): Promise<T> {
  if (!hasTauri) {
    if (import.meta.env.DEV && options.defaultValue !== undefined) {
      console.warn(`[tauriInvoke] 非 Tauri 环境，「${command}」返回默认值`);
      return options.defaultValue;
    }
    navigateToTauriRequired();
    throw new TauriRequiredError(command);
  }
  try {
    return await invoke<T>(command, args);
  } catch (err) {
    console.error(`调用「${command}」失败`, err);
    throw err;
  }
}
