import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/home")({
  component: HomeRoute,
});

function HomeRoute() {
  const [query, setQuery] = useState("");

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

      <ul className="home-grid" aria-label="功能列表">
        <li>
          <div className="home-card home-card--placeholder" aria-label="敬请期待">
            <span className="home-card__emoji" aria-hidden="true">✦</span>
            <span className="home-card__title">敬请期待</span>
          </div>
        </li>
      </ul>
    </main>
  );
}
