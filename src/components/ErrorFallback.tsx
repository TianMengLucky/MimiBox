import { Icon } from "@iconify/react";
import { router } from "../router";
import type { FallbackProps } from "react-error-boundary";
import { errorMessage } from "../lib/errors";

export function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const message = errorMessage(error);

  // 本组件也会在 main.tsx 顶层 ErrorBoundary 渲染，位于 RouterProvider
  // 之外拿不到 Router Context，因此用 router 单例导航；边界复位放在
  // 导航完成后，避免先重挂载仍报错的路由导致闪烁。
  const goHome = () => {
    void router.navigate({ to: "/home" }).finally(resetErrorBoundary);
  };

  return (
    <main
      className="box-border flex min-h-screen flex-col items-center justify-center px-8 py-12 text-center [background-image:linear-gradient(135deg,#ffdde9_0%,#fff8fb_52%,#fffdfd_100%)]"
      role="alert"
    >
      <h1 className="m-0 text-[1.6rem] font-extrabold text-[#66535a]">
        页面出错了
      </h1>
      <p className="mt-3.5 max-w-[36em] leading-[1.7] text-[#7b686f] wrap-anywhere">
        {message}
      </p>
      <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          className="inline-flex cursor-pointer items-center gap-2 rounded-full border-none bg-[#f5b3c9] px-6 py-2.5 font-bold text-[#5e4c53] shadow-[0_10px_24px_rgb(245_179_201/36%)] transition hover:bg-[#f8c3d5]"
          onClick={resetErrorBoundary}
        >
          <Icon icon="lucide:refresh-cw" width={16} height={16} aria-hidden="true" />
          重试
        </button>
        <button
          type="button"
          className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-[#eec3d2] bg-white/70 px-6 py-2.5 font-bold text-[#66535a] transition hover:bg-white"
          onClick={goHome}
        >
          <Icon icon="lucide:house" width={16} height={16} aria-hidden="true" />
          返回主页
        </button>
      </div>
    </main>
  );
}
