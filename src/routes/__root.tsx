import { ErrorFallback } from "@components/ErrorFallback";
import { CornerDock } from "@components/CornerDock";
import {
  createRootRoute,
  Link,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/router-devtools";

function RootComponent() {
  // 欢迎页（首次启动引导）保持纯净：不显示左下角的悬浮坞
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isWelcome = pathname === "/";

  return (
    <>
      <Outlet />
      {!isWelcome && (
        <div className="corner-actions">
          <CornerDock />
        </div>
      )}
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
