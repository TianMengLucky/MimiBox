import { Box, Flex } from "@apvee/react-layout-kit";
import { Button } from "@heroui/react";
import { Icon } from "@iconify/react";
import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/feature")({
  component: FeatureLayout,
});

/**
 * feature 模块底层：主界面右侧的白色低不透明度长方形面板，
 * /feature 路径下的所有内容都渲染在该面板内。
 * 结构布局（flex 链路、尺寸约束、间距骨架）用 @apvee/react-layout-kit 表达；
 * 颜色/圆角/阴影/毛玻璃等视觉样式用 Tailwind 工具类；只有覆盖 ComingSoon
 * 内部 .home 类的规则因涉及未分层页面 CSS，留在 feature.css。
 */
function FeatureLayout() {
  const navigate = useNavigate();

  return (
    // 固定视口高度 + 上下留白（顶部给 TitleBar 覆盖层），面板高度由
    // maxHeight="100%" 弹性收窄，不再用 100vh 减固定值的魔数估算
    <Flex h="100dvh" justify="flex-end" pt={96} pb={56} px={56}>
      <Box
        asChild
        className="feature-panel rounded-3xl border border-white/55 bg-white/55 shadow-[0_10px_36px_rgb(133_77_96/14%)] backdrop-blur-[16px] backdrop-saturate-[1.3] motion-reduce:bg-white/80 motion-reduce:backdrop-blur-none"
        $display="flex"
        $flexDirection="column"
        $width="calc(100vw - 160px)"
        $maxHeight="100%"
        $minHeight={0}
        $overflow="hidden"
        px={32}
        pt={26}
        pb={36}
      >
        <section aria-label="功能区域">
          <Button
            variant="tertiary"
            className="self-start rounded-full bg-white/45 px-4 font-semibold text-[#9b8a91] hover:text-[#66535a] focus-visible:text-[#66535a]"
            onPress={() => {
              // 历史感知返回：从资料库进入的页面回到资料库，无历史时兜底回主页
              if (window.history.length > 1) window.history.back();
              else navigate({ to: "/home" });
            }}
          >
            <Icon icon="lucide:chevron-left" width="16" height="16" aria-hidden="true" />
            返回
          </Button>
          <Box
            asChild
            className="feature-content [container-type:size]"
            $marginTop={14}
            $display="flex"
            $flexDirection="column"
            $flex={1}
            $minHeight={0}
            $overflowY="auto"
          >
            <div>
              <Outlet />
            </div>
          </Box>
        </section>
      </Box>
    </Flex>
  );
}
