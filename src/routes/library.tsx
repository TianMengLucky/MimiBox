import { useSyncExternalStore } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import FeatureCard from "@components/home/FeatureCard";
import { CardGrid, PageShell } from "@components/home/PageShell";
import { featureRegistry } from "../core/registry";
import { pluginRuntime } from "../core/runtime";

export const Route = createFileRoute("/library")({
  component: LibraryRoute,
});

type LibraryEntry = {
  key: string;
  title: string;
  emoji: string;
  description?: string;
  /** plugin：经通用路由 /feature/$plugin；placeholder：「敬请期待」占位卡 */
  source: "plugin" | "placeholder";
};

/** 「敬请期待」占位卡（保留在宿主） */
const COMING_SOON: LibraryEntry = {
  key: "coming-soon",
  title: "敬请期待",
  emoji: "✦",
  description: "更多内容陆续上线",
  source: "placeholder",
};

function LibraryRoute() {
  const navigate = useNavigate();
  useSyncExternalStore(featureRegistry.subscribe, featureRegistry.getVersion);
  useSyncExternalStore(pluginRuntime.subscribe, pluginRuntime.getState);

  // 已插件化功能（注册到资料库的插件）+ 敬请期待占位
  const entries: LibraryEntry[] = [
    ...featureRegistry.list("library").map((entry): LibraryEntry => ({
      key: entry.manifest.id,
      title: entry.manifest.title,
      emoji: entry.manifest.emoji || "🧩",
      description: entry.manifest.description || undefined,
      source: "plugin",
    })),
    COMING_SOON,
  ];

  return (
    // 页面外壳与卡片网格与主页共享（PageShell/CardGrid），布局由 layout-kit 提供
    <PageShell>
      <header className="mt-[7vh]">
        <h1 className="m-0 text-2xl font-extrabold tracking-tight text-[#66535a]">
          资料库
        </h1>
        <p className="m-0 mt-2 text-sm text-[#9b8a91]">收藏与检索你的看番与内容资料。</p>
      </header>

      <CardGrid label="资料库列表">
        {entries.map((entry) => (
          <li key={entry.key}>
            <FeatureCard
              title={entry.title}
              emoji={entry.emoji}
              description={entry.description}
              placeholder={entry.source === "placeholder"}
              onPress={
                entry.source === "plugin"
                  ? () =>
                      navigate({
                        to: "/feature/$plugin",
                        params: { plugin: entry.key },
                      })
                  : undefined
              }
            />
          </li>
        ))}
      </CardGrid>
    </PageShell>
  );
}
