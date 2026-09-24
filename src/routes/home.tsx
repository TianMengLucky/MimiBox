import { useState, useSyncExternalStore } from "react";
import { Icon } from "@iconify/react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import FeatureCard from "@components/home/FeatureCard";
import { CardGrid, PageShell } from "@components/home/PageShell";
import { featureRegistry } from "../core/registry";
import { pluginRuntime } from "../core/runtime";

export const Route = createFileRoute("/home")({
  component: HomeRoute,
});

type FeatureCategory = "video" | "fun";

type HomeEntry = {
  key: string;
  title: string;
  emoji: string;
  description?: string;
  /** 所属功能分类 */
  category: FeatureCategory;
  /** plugin：经通用路由 /feature/$plugin；placeholder：「敬请期待」占位卡 */
  source: "plugin" | "placeholder";
};

/** 「敬请期待」占位卡（保留在宿主） */
const COMING_SOON: HomeEntry = {
  key: "coming-soon",
  title: "敬请期待",
  emoji: "✦",
  description: "更多功能陆续上线",
  category: "fun",
  source: "placeholder",
};

/** 主页功能分类标签：新增分类时在这里加一项 */
const CATEGORY_TABS: { key: FeatureCategory; label: string }[] = [
  { key: "video", label: "视频制作" },
  { key: "fun", label: "娱乐功能" },
];

/** 上次选中的分类：主页路由卸载后仍保留，从功能页返回时恢复 */
let lastCategory: FeatureCategory = "video";

function HomeRoute() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<FeatureCategory>(lastCategory);
  const navigate = useNavigate();
  // 订阅插件注册表：插件异步加载完成后卡片自动出现
  useSyncExternalStore(featureRegistry.subscribe, featureRegistry.getVersion);
  useSyncExternalStore(pluginRuntime.subscribe, pluginRuntime.getState);

  const selectCategory = (key: FeatureCategory) => {
    lastCategory = key;
    setCategory(key);
  };

  // 已插件化功能（注册表）+ 敬请期待占位
  const entries: HomeEntry[] = [
    ...featureRegistry.list("home").map((entry): HomeEntry => ({
      key: entry.manifest.id,
      title: entry.manifest.title,
      emoji: entry.manifest.emoji || "🧩",
      description: entry.manifest.description || undefined,
      category: entry.manifest.category === "video" ? "video" : "fun",
      source: "plugin",
    })),
    COMING_SOON,
  ];

  const keyword = query.trim();
  const visibleList = entries.filter(
    (entry) =>
      entry.category === category &&
      (keyword === "" || entry.title.includes(keyword)),
  );

  return (
    // 页面外壳与卡片网格是 home / library 共享组件（PageShell/CardGrid），
    // 搜索框/标签的视觉样式留在 home.css
    <PageShell>
      <label className="home-search">
        <span className="sr-only">搜索功能</span>
        <Icon icon="lucide:search" width="18" height="18" aria-hidden="true" />
        <input
          type="search"
          placeholder="搜索功能…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      <div className="home-tabs segment-tabs" role="group" aria-label="功能分类">
        {CATEGORY_TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            aria-pressed={category === key}
            onClick={() => selectCategory(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 功能卡片网格：auto-fill 自适应列数（共享 CardGrid） */}
      <CardGrid label="功能列表">
        {visibleList.map((entry) => (
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

      {visibleList.length === 0 ? (
        <p className="home-empty">没有找到匹配的功能</p>
      ) : null}
    </PageShell>
  );
}
