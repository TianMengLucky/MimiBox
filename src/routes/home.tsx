import { createFileRoute } from "@tanstack/react-router";
import appIcon from "@assets/app-icon.png";

export const Route = createFileRoute("/home")({
  component: HomeRoute,
});

function HomeRoute() {
  return (
    <main className="home">
      <img src={appIcon} alt="" className="home__icon" aria-hidden="true" />
      <h1 className="home__title">美美工具箱</h1>
      <p className="home__hint">这里还什么都没有，敬请期待。</p>
    </main>
  );
}
