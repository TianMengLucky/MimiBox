import { createFileRoute, useNavigate } from "@tanstack/react-router";
import FeatureCard from "@components/home/FeatureCard";
import { CardGrid, PageShell } from "@components/home/PageShell";

export const Route = createFileRoute("/library")({
  component: LibraryRoute,
});

type LibraryEntry = {
  key: string;
  title: string;
  emoji: string;
  description?: string;
  /** 目标路由；缺省时渲染为「敬请期待」占位卡片 */
  to?: "/feature/anime";
};

/** 资料库入口列表：新增内容时在这里加一项 */
const LIBRARY_LIST: LibraryEntry[] = [
  {
    key: "anime",
    title: "番剧",
    emoji: "📺",
    description: "每日放送时间表",
    to: "/feature/anime",
  },
  {
    key: "coming-soon",
    title: "敬请期待",
    emoji: "✦",
    description: "更多内容陆续上线",
  },
];

function LibraryRoute() {
  const navigate = useNavigate();

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
        {LIBRARY_LIST.map(({ key, title, emoji, description, to }) => (
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
    </PageShell>
  );
}
