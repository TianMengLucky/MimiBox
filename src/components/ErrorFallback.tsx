import type { FallbackProps } from "react-error-boundary";

export function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const message = error instanceof Error ? error.message : String(error);

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
      <button
        type="button"
        className="mt-7 cursor-pointer rounded-full border-none bg-[#f5b3c9] px-6 py-2.5 font-bold text-[#5e4c53] shadow-[0_10px_24px_rgb(245_179_201/36%)]"
        onClick={resetErrorBoundary}
      >
        重试
      </button>
    </main>
  );
}
