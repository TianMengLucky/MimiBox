import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/home")({
  component: HomeRoute,
});

/** 主页卡片入口：搜索框按 title/description 过滤，点击进入对应页面 */
const entries = [
  {
    key: "account",
    title: "账号",
    description: "登录与管理你的账号信息",
    to: "/account" as const,
    emoji: "🎀",
  },
  {
    key: "settings",
    title: "设置",
    description: "外观、行为与个性化选项",
    to: "/settings" as const,
    emoji: "🫧",
  },
  {
    key: "about",
    title: "关于",
    description: "了解美美工具箱的故事",
    to: "/about" as const,
    emoji: "📖",
  },
  {
    key: "feedback",
    title: "反馈",
    description: "告诉我们你的想法与建议",
    to: "/feedback" as const,
    emoji: "💌",
  },
];

function HomeRoute() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return entries;
    return entries.filter(({ title, description }) =>
      `${title} ${description}`.toLowerCase().includes(keyword),
    );
  }, [query]);

  return (
    <main className="home-page">
      <label className="home-search">
        <span className="sr-only">搜索功能</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
          width="18"
          height="18"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.8-3.8" />
        </svg>
        <input
          type="search"
          placeholder="搜索功能…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {filtered.length > 0 ? (
        <ul className="home-grid">
          {filtered.map((entry) => (
            <li key={entry.key}>
              <button
                type="button"
                className="home-card"
                onClick={() => navigate({ to: entry.to })}
              >
                <span className="home-card__emoji" aria-hidden="true">
                  {entry.emoji}
                </span>
                <span className="home-card__title">{entry.title}</span>
                <span className="home-card__desc">{entry.description}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="home-empty">
          没有找到与「{query.trim()}」相关的功能，换个关键词试试吧。
        </p>
      )}
    </main>
  );
}
