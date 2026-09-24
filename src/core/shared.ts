/** 共享模块注册表：宿主向插件 bundle 提供的 require 解析表。
 *
 * 插件前端经 esbuild 以 CJS 工厂打包，react / HeroUI 等依赖不进 bundle，
 * 运行时通过 `hostRequire(name)` 解析到宿主的同一模块实例——
 * 经典微前端共享 React 方案，杜绝双 React。
 * 单插件专属依赖（lucky-canvas、xyflow 等）打包进插件自身。
 */

import * as React from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as JsxRuntime from "react/jsx-runtime";
import * as HeroUI from "@heroui/react";
import * as IconifyReact from "@iconify/react";
import * as LayoutKit from "@apvee/react-layout-kit";
import * as MotionReact from "motion/react";
import * as Router from "@tanstack/react-router";
import { listen } from "@tauri-apps/api/event";
import * as pluginDialog from "@tauri-apps/plugin-dialog";

import { hasTauri, pluginInvoke, tauriInvoke } from "../lib/tauriInvoke";
import { errorMessage } from "../lib/errors";
import { formatBytes, formatTime } from "../lib/format";
import { hasDragType, readDragJson, setDragJson } from "../lib/dnd";
import { useConfirmClear } from "../lib/useConfirmClear";
import * as FileDropZoneModule from "@components/FileDropZone";
import * as imageModule from "@components/image";
import * as SchemeBarModule from "@components/SchemeBar";
import * as SchemeStoreModule from "@components/schemeStore";
import * as SchemeTransferModule from "@components/schemeTransfer/SchemeTransfer";
import * as SchemeTransferIo from "@components/schemeTransfer/io";
import * as ComingSoonModule from "@components/screen/ComingSoon";
import * as PageLoadingModule from "@components/screen/PageLoading";
import * as FeatureCardModule from "@components/home/FeatureCard";
import * as PageShellModule from "@components/home/PageShell";
import { defineMbPlugin } from "./plugin-api";

declare global {
  interface Window {
    /** 宿主提供的共享模块表（插件 require 解析） */
    __mb_shared?: Record<string, unknown>;
    /** 插件 CJS 工厂（esbuild banner 注入注册） */
    __mb_plugins?: Record<
      string,
      (
        require: (name: string) => unknown,
        module: { exports: Record<string, unknown> },
        exports: Record<string, unknown>,
      ) => void
    >;
  }
}

/** 插件可 require 的共享模块（key 与构建脚本的 external 列表保持一致） */
const SHARED_MODULES: Record<string, unknown> = {
  react: React,
  "react-dom": ReactDOM,
  "react-dom/client": ReactDOMClient,
  "react/jsx-runtime": JsxRuntime,
  "@heroui/react": HeroUI,
  "@iconify/react": IconifyReact,
  "@apvee/react-layout-kit": LayoutKit,
  "motion/react": MotionReact,
  "@tanstack/react-router": Router,
  "@tauri-apps/api/event": { listen },
  "@tauri-apps/plugin-dialog": pluginDialog,
  // 宿主基础库
  "@lib/tauriInvoke": { hasTauri, tauriInvoke, pluginInvoke },
  "@lib/errors": { errorMessage },
  "@lib/format": { formatBytes, formatTime },
  "@lib/dnd": { hasDragType, readDragJson, setDragJson },
  "@lib/useConfirmClear": { useConfirmClear },
  // 宿主共享组件（跨插件复用）
  "@components/FileDropZone": FileDropZoneModule,
  "@components/image": imageModule,
  "@components/SchemeBar": SchemeBarModule,
  "@components/schemeStore": SchemeStoreModule,
  "@components/schemeTransfer/SchemeTransfer": SchemeTransferModule,
  "@components/schemeTransfer/io": SchemeTransferIo,
  "@components/screen/ComingSoon": ComingSoonModule,
  "@components/screen/PageLoading": PageLoadingModule,
  "@components/home/FeatureCard": FeatureCardModule,
  "@components/home/PageShell": PageShellModule,
  // 插件 API
  "mb-host": { defineMbPlugin },
};

/** 安装全局共享模块表（插件 bundle 的 require 由此解析） */
export function installSharedModules(): void {
  window.__mb_shared = SHARED_MODULES;
}

/** 插件 bundle 的 require 实现 */
export function hostRequire(name: string): unknown {
  const mod = SHARED_MODULES[name];
  if (mod === undefined) {
    throw new Error(`插件引用了宿主未提供的模块「${name}」`);
  }
  return mod;
}
