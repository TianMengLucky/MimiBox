import { Flex, Box } from "@apvee/react-layout-kit";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@heroui/react";
import { Icon } from "@iconify/react";
import { UpdateSection } from "@components/settings/UpdateSection";

export const Route = createFileRoute("/settings")({
  component: SettingsRoute,
});

/** 设置页：全屏垂直居中；布局由 layout-kit 提供，面板样式与关于页保持一致。
 * 插件管理已独立为 /plugins 页，这里保留前往入口。 */
function SettingsRoute() {
  const navigate = useNavigate();

  return (
    <Flex direction="column" align="center" justify="center" mih="100dvh" px={96} py={80}>
      <Box
        asChild
        className="page-in rounded-3xl border border-white/55 bg-white/60 shadow-[0_8px_30px_rgb(133_77_96/14%)] backdrop-blur-[16px] backdrop-saturate-[1.3] motion-reduce:bg-white/80 motion-reduce:backdrop-blur-none"
        $width="100%"
        $maxWidth={448}
        py={24}
        px={28}
      >
        <section aria-label="设置">
          <div className="flex items-center justify-between gap-2 pb-3">
            <span className="text-sm text-[#66535a]">插件管理</span>
            <Button
              variant="tertiary"
              size="sm"
              onPress={() => void navigate({ to: "/plugins" })}
              className="rounded-full bg-white/45 font-semibold text-[#9b8a91] hover:text-[#66535a] focus-visible:text-[#66535a]"
            >
              <Icon icon="lucide:puzzle" width="14" height="14" aria-hidden="true" />
              前往管理
            </Button>
          </div>
          <UpdateSection />
        </section>
      </Box>
    </Flex>
  );
}
