import { Flex, Box } from "@apvee/react-layout-kit";
import { createFileRoute } from "@tanstack/react-router";
import { UpdateSection } from "@components/settings/UpdateSection";

export const Route = createFileRoute("/settings")({
  component: SettingsRoute,
});

/** 设置页：全屏垂直居中；布局由 layout-kit 提供，面板样式与关于页保持一致 */
function SettingsRoute() {
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
          <UpdateSection />
        </section>
      </Box>
    </Flex>
  );
}
