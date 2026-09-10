import { useState } from "react";
import { Icon } from "@iconify/react";
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
        <Icon icon="lucide:search" width="18" height="18" aria-hidden="true" />
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
