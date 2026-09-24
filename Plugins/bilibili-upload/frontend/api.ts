/** B 站投稿后端命令与进度事件的封装：经插件上下文走网关调用本插件命令 */
import type { MbPluginContext } from "mb-host";
import { tauriInvoke } from "@lib/tauriInvoke";
import type { SubmitOutcome, UploadProgress, UploadZoneMain, VideoFileInfo } from "./types";

/** 投稿参数（与后端 UploadParams 的 camelCase 字段对应） */
export interface UploadParams {
  videoPath: string;
  title: string;
  desc: string;
  tid: number;
  tags: string[];
  /** 1 自制 / 2 转载 */
  copyright: 1 | 2;
  /** 转载来源（copyright=2 时必填） */
  source: string;
  /** 封面 URL（可空，空则由 B 站自动截取） */
  cover: string;
  noReprint: boolean;
  openElec: boolean;
  dynamic: string;
}

/** B 站投稿插件前端 API（index.tsx 里用插件上下文构造后传入页面与组件） */
export interface BilibiliUploadApi {
  /** 投稿分区表（一级分区 + 子分区） */
  getZones(): Promise<UploadZoneMain[]>;
  /** 探测待上传视频文件（名称与大小） */
  probeVideo(path: string): Promise<VideoFileInfo>;
  /** 上传封面（data URI），返回 B 站封面 URL */
  uploadCover(dataUri: string): Promise<{ url: string }>;
  /** 开始投稿（长任务，进度经 onProgress 事件推送，返回即任务终结） */
  startUpload(params: UploadParams): Promise<SubmitOutcome>;
  /** 请求取消当前上传任务 */
  cancelUpload(): Promise<void>;
  /** 订阅上传进度事件（bilibili-upload-progress）；返回取消订阅函数 */
  onProgress(handler: (progress: UploadProgress) => void): Promise<() => void>;
  /** 用系统默认浏览器打开 URL（宿主 opener 插件命令） */
  openOutcomeUrl(url: string): Promise<void>;
}

export function createBilibiliUploadApi(ctx: MbPluginContext): BilibiliUploadApi {
  return {
    getZones: () => ctx.invoke<UploadZoneMain[]>("bilibili_upload_cats"),
    probeVideo: (path) => ctx.invoke<VideoFileInfo>("bilibili_upload_probe", { path }),
    uploadCover: (dataUri) => ctx.invoke<{ url: string }>("bilibili_upload_cover", { dataUri }),
    startUpload: (params) => ctx.invoke<SubmitOutcome>("bilibili_upload_start", { params }),
    cancelUpload: () => ctx.invoke<void>("bilibili_upload_cancel"),
    onProgress: (handler) => ctx.listen<UploadProgress>("bilibili-upload-progress", handler),
    // 共享模块表未提供 @tauri-apps/plugin-opener 的 JS 封装（esbuild 亦外置
    // @tauri-apps/*），改为直调其底层命令；入参与 JS 封装 openUrl 一致，
    // https URL 已由 capabilities 的 opener:default 覆盖
    openOutcomeUrl: (url) => tauriInvoke<void>("plugin:opener|open_url", { url }),
  };
}
