import type { FallbackProps } from "react-error-boundary";

export function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const message = error instanceof Error ? error.message : String(error);

  return (
    <main className="error-fallback" role="alert">
      <h1>页面出错了</h1>
      <p className="error-fallback__message">{message}</p>
      <button type="button" className="error-fallback__retry" onClick={resetErrorBoundary}>
        重试
      </button>
    </main>
  );
}
