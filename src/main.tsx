import React from "react";
import ReactDOM from "react-dom/client";
import { ErrorBoundary } from "react-error-boundary";
import { MotionConfig } from "motion/react";
import { RouterProvider } from "@tanstack/react-router";
import { ErrorFallback } from "@components/ErrorFallback";
import { startPluginRuntime } from "./core/runtime";
import { router } from "./router";
import "./icons";
import "@style/index.css";

// 插件运行时后台启动：清单读取 + 脚本注入 + 功能注册（不阻塞首屏渲染，
// 主页/资料库/通用功能页经功能注册表订阅渲染进度）
void startPluginRuntime();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary
      FallbackComponent={ErrorFallback}
      onReset={() => router.invalidate()}
    >
      {/* reducedMotion="user"：所有 motion 动效自动跟随系统「减弱动态效果」设置 */}
      <MotionConfig reducedMotion="user">
        <RouterProvider router={router} />
      </MotionConfig>
    </ErrorBoundary>
  </React.StrictMode>,
);
