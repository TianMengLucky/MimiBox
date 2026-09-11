import { createFileRoute } from "@tanstack/react-router";
import { UpdateSection } from "@components/settings/UpdateSection";

export const Route = createFileRoute("/settings")({
  component: SettingsRoute,
});

/** 设置页：左右留 96px 避开左下角悬浮坞，面板样式与账号页保持一致 */
function SettingsRoute() {
  return (
    <main className="box-border flex min-h-dvh flex-col items-center justify-center px-24 py-20">
      <section
        aria-label="设置"
        className="w-full max-w-md rounded-3xl border border-white/55 bg-white/60 px-7 py-6 shadow-[0_8px_30px_rgb(133_77_96/14%)] backdrop-blur-[16px] backdrop-saturate-[1.3] motion-reduce:bg-white/80 motion-reduce:backdrop-blur-none"
      >
        <UpdateSection />
      </section>
    </main>
  );
}
