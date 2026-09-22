import { Box, Flex } from "@apvee/react-layout-kit";
import { useEffect, useState } from "react";
import { Button } from "@heroui/react";
import { Icon } from "@iconify/react";
import { createFileRoute } from "@tanstack/react-router";
import appIcon from "@assets/app-icon.png";
import { hasTauri } from "../lib/tauriInvoke";

const GITHUB_URL = "https://github.com/TianMengLucky/MimiBox";

export const Route = createFileRoute("/about")({
  component: AboutRoute,
});

/** 关于页：应用信息与开源信息；检查更新的完整流程统一放在设置页，这里不再重复入口 */
function AboutRoute() {
  const [version, setVersion] = useState("v0.1.0");

  useEffect(() => {
    if (!hasTauri) return;
    void import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then((value) => setVersion(`v${value}`))
      .catch(() => {});
  }, []);

  const openGitHub = async () => {
    if (hasTauri) {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(GITHUB_URL).catch(() => {});
    } else {
      window.open(GITHUB_URL, "_blank");
    }
  };

  return (
    // 页面外壳：全屏垂直居中；布局由 layout-kit 提供，视觉样式用 Tailwind
    <Flex direction="column" align="center" justify="center" mih="100dvh" px={96} py={80}>
      <Box
        asChild
        className="page-in rounded-3xl border border-white/55 bg-white/60 shadow-[0_8px_30px_rgb(133_77_96/14%)] backdrop-blur-[16px] backdrop-saturate-[1.3] motion-reduce:bg-white/80 motion-reduce:backdrop-blur-none"
        $width="100%"
        $maxWidth={448}
        p={28}
      >
        <section aria-label="关于">
          <Flex align="center" gap={16}>
            <img
              src={appIcon}
              alt=""
              aria-hidden="true"
              className="h-14 w-14 rounded-2xl shadow-[0_4px_14px_rgb(133_77_96/25%)]"
            />
            <Box $minWidth={0}>
              <h1 className="m-0 truncate text-left text-lg font-bold text-[#513844]">
                美美工具箱
              </h1>
              <p className="m-0 mt-0.5 text-sm text-[#9b8a91]">
                粉色治愈系的桌面小工具箱
              </p>
            </Box>
          </Flex>

          <p className="mt-4 mb-0 text-sm leading-relaxed text-[#66535a]">
            集视频创作与娱乐互动于一体的跨平台桌面工具箱。名字里的「美美」是
            《与你相恋到生命尽头》中一名粉色可爱的小女孩。
          </p>

          <dl className="mt-4 mb-0 divide-y divide-white/60 border-t border-white/60 text-sm">
            <Flex align="center" justify="space-between" gap={12} py={12}>
              <dt className="text-[#66535a]">当前版本</dt>
              <dd className="m-0 font-semibold text-[#66535a]">{version}</dd>
            </Flex>
            <Flex align="center" justify="space-between" gap={12} py={12}>
              <dt className="text-[#66535a]">开源许可</dt>
              <dd className="m-0 font-semibold text-[#66535a]">GPL-3.0-only</dd>
            </Flex>
            <Flex align="center" justify="space-between" gap={12} py={12}>
              <dt className="text-[#66535a]">技术栈</dt>
              <dd className="m-0 font-semibold text-[#66535a]">
                Tauri 2 · React · Rust
              </dd>
            </Flex>
          </dl>

          <Flex align="center" gap={10} mt={20}>
            <Button
              variant="primary"
              size="sm"
              onPress={() => void openGitHub()}
              className="rounded-full px-5 font-semibold"
            >
              <Icon icon="simple-icons:github" width="16" height="16" aria-hidden="true" />
              GitHub 主页
            </Button>
          </Flex>

          <p className="mt-6 mb-0 text-center text-xs text-[#9b8a91]/80">
            © 2026 TianMengLucky · 用心制作
          </p>
        </section>
      </Box>
    </Flex>
  );
}
