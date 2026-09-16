import { useState } from "react";
import { Icon } from "@iconify/react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import FeatureCard from "@components/home/FeatureCard";
import { CardGrid, PageShell } from "@components/home/PageShell";

export const Route = createFileRoute("/home")({
  component: HomeRoute,
});

type FeatureCategory = "video" | "fun";

type FeatureEntry = {
  key: string;
  title: string;
  emoji: string;
  description?: string;
  /** 所属功能分类 */
  category: FeatureCategory;
  /** 目标路由；缺省时渲染为“敬请期待”占位卡片。新增功能页面后把路由字面量加进联合类型 */
  to?:
    | "/feature/lottery"
    | "/feature/tier-list"
    | "/feature/bobing"
    | "/feature/prediction"
    | "/feature/rating"
    | "/feature/bilibili-comments";
};

/** 主页功能分类标签：新增分类时在这里加一项 */
const CATEGORY_TABS: { key: FeatureCategory; label: string }[] = [
  { key: "video", label: "视频制作" },
  { key: "fun", label: "娱乐功能" },
];

/** 主页功能入口列表：新增功能时在这里加一项 */
const FEATURE_LIST: FeatureEntry[] = [
  {
    key: "lottery",
    title: "抽奖",
    emoji: "🎁",
    description: "幸运转盘",
    category: "fun",
    to: "/feature/lottery",
  },
  {
    key: "tier-list",
    title: "夯到拉",
    emoji: "🏆",
    description: "图片排名表",
    category: "video",
    to: "/feature/tier-list",
  },
  {
    key: "prediction",
    title: "赛事预测",
    emoji: "🏅",
    description: "晋级节点预测图",
    category: "video",
    to: "/feature/prediction",
  },
  {
    key: "rating",
    title: "评分",
    emoji: "⭐",
    description: "批量打 1-10 分",
    category: "video",
    to: "/feature/rating",
  },
  {
    key: "bilibili-comments",
    title: "B站评论区",
    emoji: "💬",
    description: "查看并筛选投稿评论",
    category: "video",
    to: "/feature/bilibili-comments",
  },
  {
    key: "bobing",
    title: "博饼",
    emoji: "🎲",
    description: "掷骰夺状元",
    category: "fun",
    to: "/feature/bobing",
  },
  {
    key: "coming-soon",
    title: "敬请期待",
    emoji: "✦",
    description: "更多功能陆续上线",
    category: "fun",
  },
];

/** 上次选中的分类：主页路由卸载后仍保留，从功能页返回时恢复 */
let lastCategory: FeatureCategory = "video";

function HomeRoute() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<FeatureCategory>(lastCategory);
  const navigate = useNavigate();

  const selectCategory = (key: FeatureCategory) => {
    lastCategory = key;
    setCategory(key);
  };

  const keyword = query.trim();
  const visibleList = FEATURE_LIST.filter(
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
        {visibleList.map(({ key, title, emoji, description, to }) => (
          <li key={key}>
            <FeatureCard
              title={title}
              emoji={emoji}
              description={description}
              placeholder={!to}
              onPress={to ? () => navigate({ to }) : undefined}
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
