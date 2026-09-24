/** 弹幕插件前端 API：包装本插件后端命令、账号插件调用与事件订阅（经宿主插件上下文） */
import type { MbPluginContext } from "mb-host";
import type { DanmakuMessage, DanmakuRoom, DanmakuSnapshot, DanmakuStatus } from "./types";

/** 弹幕事件名（插件后端 Rust 端广播） */
export const DANMAKU_MESSAGE_EVENT = "danmaku-message";
export const DANMAKU_STATUS_EVENT = "danmaku-status";

/** 账号列表条目（账号插件 account_list 返回，过滤出 B 站账号） */
export interface AccountEntry {
  dedeUserId: string;
  platform: "bilibili" | "douyin";
  uname: string | null;
  face: string | null;
  active: boolean;
  credentialStatus: "valid" | "expired" | "unknown";
}

/** Tauri 内部桥：@tauri-apps/api/window 不在宿主共享模块表里（esbuild 外置
 *  "@tauri-apps/*" 会在运行时 require 失败），窗口控制退回内部 invoke 桥——
 *  它与 @tauri-apps/api/core 的 invoke 等价；窗口 label 取自宿主注入的
 *  metadata（弹幕窗口固定为 "danmaku"，与 capabilities/danmaku.json 的
 *  close/minimize 授权范围一致）。 */
type TauriInternals = {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  metadata?: { currentWindow?: { label?: string } };
};

function tauriInternals(): TauriInternals | null {
  const internals = (window as unknown as { __TAURI_INTERNALS__?: TauriInternals })
    .__TAURI_INTERNALS__;
  return internals ?? null;
}

/** 窗口控制（Tauri v2 core window 插件命令） */
async function windowCommand(command: "minimize" | "close"): Promise<void> {
  const internals = tauriInternals();
  if (!internals) return;
  const label = internals.metadata?.currentWindow?.label ?? "danmaku";
  await internals.invoke(`plugin:window|${command}`, { label });
}

/** 弹幕插件前端 API（index.tsx 用插件上下文构造后传入页面） */
export interface DanmakuApi {
  /** 打开（或聚焦）弹幕独立窗口 */
  openWindow(): Promise<void>;
  /** 连接指定 B 站账号（mid）的直播间，成功返回直播间信息 */
  connect(mid: string): Promise<DanmakuRoom>;
  /** 断开当前连接 */
  disconnect(): Promise<void>;
  /** 当前状态 + 最近弹幕缓冲（页面挂载时补齐错过的内容） */
  snapshot(): Promise<DanmakuSnapshot>;
  /** B 站账号列表（依赖账号插件 account_list） */
  listAccounts(): Promise<AccountEntry[]>;
  /** 订阅弹幕消息事件，返回取消函数 */
  listenMessage(handler: (message: DanmakuMessage) => void): Promise<() => void>;
  /** 订阅连接状态事件，返回取消函数 */
  listenStatus(handler: (status: DanmakuStatus) => void): Promise<() => void>;
  /** 最小化弹幕窗口（自绘标题栏按钮） */
  minimizeWindow(): Promise<void>;
  /** 关闭弹幕窗口（自绘标题栏按钮） */
  closeWindow(): Promise<void>;
}

export function createDanmakuApi(ctx: MbPluginContext): DanmakuApi {
  return {
    openWindow: () => ctx.invoke<void>("danmaku_open"),
    connect: (mid) => ctx.invoke<DanmakuRoom>("danmaku_connect", { mid }),
    disconnect: () => ctx.invoke<void>("danmaku_disconnect"),
    snapshot: () => ctx.invoke<DanmakuSnapshot>("danmaku_snapshot"),
    listAccounts: () => ctx.invokePlugin<AccountEntry[]>("account", "account_list"),
    listenMessage: (handler) => ctx.listen<DanmakuMessage>(DANMAKU_MESSAGE_EVENT, handler),
    listenStatus: (handler) => ctx.listen<DanmakuStatus>(DANMAKU_STATUS_EVENT, handler),
    minimizeWindow: () => windowCommand("minimize"),
    closeWindow: () => windowCommand("close"),
  };
}
