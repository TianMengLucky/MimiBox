import { useEffect, useState } from "react";
import { ErrorFallback } from "@components/ErrorFallback";
import { CornerDock } from "@components/CornerDock";
import { Screensaver } from "@components/screen/Screensaver";
import { TitleBar } from "@components/TitleBar";
import {
  createRootRoute,
  Link,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/router-devtools";

/** 闲置超过该毫秒数后进入屏保；生产为 15 分钟，开发模式缩短便于测试 */
const IDLE_TIMEOUT_MS = import.meta.env.DEV ? 20_000 : 15 * 60 * 1000;

function RootComponent() {
  // 欢迎页（首次启动引导）保持纯净：不显示左下角的悬浮坞
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isWelcome = pathname === "/";

  // 极简（背景）模式：隐藏路径内容并解除路径按钮高亮，仅菜单栏按钮切换。
  const [minimal, setMinimal] = useState(false);

  // 闲置屏保：长时间无操作进入钟面屏保，任意操作返回。
  const [screensaver, setScreensaver] = useState(false);

  useEffect(() => {
    let timer = window.setTimeout(() => setScreensaver(true), IDLE_TIMEOUT_MS);
    const reset = () => {
      setScreensaver(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setScreensaver(true), IDLE_TIMEOUT_MS);
    };
    // 仅“点击/操作应用内容”才算活动；单纯移动鼠标不重置计时
    const events = ["pointerdown", "keydown", "wheel", "touchstart"];
    for (const type of events) window.addEventListener(type, reset, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const type of events) window.removeEventListener(type, reset);
    };
  }, []);

  return (
    <>
      {!screensaver && <TitleBar />}
      {!screensaver && !minimal && <Outlet />}
      {!isWelcome && !screensaver && (
        <div className="corner-actions">
          <CornerDock
            highlight={!minimal}
            onActivePress={() => setMinimal((value) => !value)}
          />
        </div>
      )}
      {screensaver && <Screensaver />}
      {import.meta.env.DEV && <TanStackRouterDevtools position="bottom-right" />}
    </>
  );
}

export const Route = createRootRoute({
  component: RootComponent,
  errorComponent: ({ error, reset }) => (
    <ErrorFallback error={error} resetErrorBoundary={reset} />
  ),
  notFoundComponent: () => (
    <main className="container">
      <h1>页面不存在</h1>
      <p>
        <Link to="/">返回首页</Link>
      </p>
    </main>
  ),
});
