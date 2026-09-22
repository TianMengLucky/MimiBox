import React from "react";
import ReactDOM from "react-dom/client";
import { ErrorBoundary } from "react-error-boundary";
import { MotionConfig } from "motion/react";
import { RouterProvider } from "@tanstack/react-router";
import { ErrorFallback } from "@components/ErrorFallback";
import { router } from "./router";
import "./icons";
import "@style/index.css";

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
