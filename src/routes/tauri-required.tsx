import { Button } from "@heroui/react";
import { Icon } from "@iconify/react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/tauri-required")({
  component: TauriRequiredRoute,
});

/** 非 Tauri 环境（纯浏览器）打开功能页时的提示页 */
function TauriRequiredRoute() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 p-6 text-center">
      <span
        aria-hidden="true"
        className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-[#ffd9e8] to-[#c9a7dd] shadow-[0_10px_30px_rgb(133_77_96/25%)]"
      >
        <Icon
          icon="simple-icons:bilibili"
          width="40"
          height="40"
          className="text-white drop-shadow"
        />
      </span>

      <div className="max-w-md">
        <h1 className="m-0 text-xl font-extrabold tracking-tight text-[#66535a]">
          需要在应用内打开
        </h1>
        <p className="m-0 mt-2 text-sm leading-relaxed text-[#9b8a91]">
          这个功能依赖 MimiBox 桌面应用提供的本地能力（登录凭据、网络请求与文件读写），
          在浏览器里无法使用。请打开 MimiBox 应用后再试。
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          onPress={() => void navigate({ to: "/home" })}
          className="rounded-full px-5 font-semibold"
        >
          <Icon icon="lucide:house" width="16" height="16" aria-hidden="true" />
          返回主页
        </Button>
        <Button
          variant="tertiary"
          size="sm"
          onPress={() => window.location.reload()}
          className="rounded-full px-5 font-semibold"
        >
          <Icon icon="lucide:refresh-cw" width="16" height="16" aria-hidden="true" />
          重新检查
        </Button>
      </div>
    </div>
  );
}
