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

type FeatureCategory = string;

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

/** 「敬请期待」占位卡（保留在宿主；每个类别页都会展示） */
const COMING_SOON = {
  key: "coming-soon",
  title: "敬请期待",
  emoji: "✦",
  description: "更多功能陆续上线",
} as const;

/** 内置类别的页签标签；未登记的类别直接以插件声明的 category 值作为标签
 * （因此插件可以用中文类别，如 `category: "工具"`） */
const CATEGORY_LABELS: Record<string, string> = {
  video: "视频制作",
  fun: "娱乐功能",
};

/** 上次选中的分类：主页路由卸载后仍保留，从功能页返回时恢复 */
let lastCategory: FeatureCategory | null = null;

function HomeRoute() {
  const [query, setQuery] = useState("");
  // 上次选中的类别（模块级持久，跨路由卸载恢复）；类别已不存在时回退第一个
  const [selected, setSelected] = useState<FeatureCategory | null>(lastCategory);
  const navigate = useNavigate();
  // 订阅插件注册表：插件异步加载完成后卡片自动出现
  useSyncExternalStore(featureRegistry.subscribe, featureRegistry.getVersion);
  useSyncExternalStore(pluginRuntime.subscribe, pluginRuntime.getState);

  // 类别页签按注册表动态生成（保持注册顺序去重）：插件可在 plugin.json
  // 的 category 里声明任意功能类别，新增类别无需改动宿主
  const categories = featureRegistry
    .list("home")
    .map((entry) => entry.manifest.category || "fun")
    .filter((key, index, all) => all.indexOf(key) === index);

  // 选中类别：优先恢复上次选择；类别已不存在（插件被删/变更）时回退第一个
  const category =
    selected && categories.includes(selected) ? selected : (categories[0] ?? "fun");

  const selectCategory = (key: FeatureCategory) => {
    lastCategory = key;
    setSelected(key);
  };

  const pluginEntries: HomeEntry[] = featureRegistry.list("home").map((entry) => ({
    key: entry.manifest.id,
    title: entry.manifest.title,
    emoji: entry.manifest.emoji || "🧩",
    description: entry.manifest.description || undefined,
    category: entry.manifest.category || "fun",
    source: "plugin",
  }));

  const keyword = query.trim();
  const visibleList = pluginEntries.filter(
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
        {categories.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={category === key}
            onClick={() => selectCategory(key)}
          >
            {CATEGORY_LABELS[key] ?? key}
          </button>
        ))}
      </div>

      {/* 功能卡片网格：auto-fill 自适应列数（共享 CardGrid）；
          「敬请期待」占位卡在所有类别页固定展示 */}
      <CardGrid label="功能列表">
        {visibleList.map((entry) => (
          <li key={entry.key}>
            <FeatureCard
              title={entry.title}
              emoji={entry.emoji}
              description={entry.description}
              onPress={() =>
                navigate({
                  to: "/feature/$plugin",
                  params: { plugin: entry.key },
                })
              }
            />
          </li>
        ))}
        <li>
          <FeatureCard
            title={COMING_SOON.title}
            emoji={COMING_SOON.emoji}
            description={COMING_SOON.description}
            placeholder
          />
        </li>
      </CardGrid>

      {keyword !== "" && visibleList.length === 0 ? (
        <p className="home-empty">没有找到匹配的功能</p>
      ) : null}
    </PageShell>
  );
}
