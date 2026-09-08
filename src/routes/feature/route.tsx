import { Button } from "@heroui/react";
import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/feature")({
  component: FeatureLayout,
});

/**
 * feature 模块底层：主界面右侧的白色低不透明度长方形面板，
 * /feature 路径下的所有内容都渲染在该面板内。
 * 简单样式直接用 Tailwind 工具类；只有覆盖 ComingSoon 内部
 * .home 类的规则因涉及未分层页面 CSS，留在 feature.css。
 */
function FeatureLayout() {
  const navigate = useNavigate();

  return (
    <div className="box-border flex min-h-screen justify-end px-14 pt-24 pb-14">
      <section
        aria-label="功能区域"
        className="feature-panel box-border flex max-h-[calc(100vh_-_152px)] w-[min(700px,calc(100vw_-_320px))] flex-col overflow-hidden rounded-3xl border border-white/55 bg-white/55 px-8 pt-[26px] pb-9 shadow-[0_10px_36px_rgb(133_77_96/14%)] backdrop-blur-[16px] backdrop-saturate-[1.3] motion-reduce:bg-white/80 motion-reduce:backdrop-blur-none"
      >
        <Button
          variant="tertiary"
          className="self-start rounded-full bg-white/45 px-4 font-semibold text-[#9b8a91] hover:text-[#66535a] focus-visible:text-[#66535a]"
          onPress={() => navigate({ to: "/home" })}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            width="16"
            height="16"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
          返回
        </Button>
        <div className="feature-content mt-3.5 box-border flex min-h-0 flex-1 flex-col overflow-y-auto">
          <Outlet />
        </div>
      </section>
    </div>
  );
}
