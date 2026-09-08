import React from "react";
import ReactDOM from "react-dom/client";
import { ErrorBoundary } from "react-error-boundary";
import { RouterProvider } from "@tanstack/react-router";
import { ErrorFallback } from "@components/ErrorFallback";
import { router } from "./router";
import "@style/index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary
      FallbackComponent={ErrorFallback}
      onReset={() => router.invalidate()}
    >
      <RouterProvider router={router} />
    </ErrorBoundary>
  </React.StrictMode>,
);
