/** 番剧插件前端入口：注册资料库功能页面（卡片元数据来自 plugin.json 清单） */
import { defineMbPlugin } from "mb-host";
import AnimePage from "./AnimePage";
import { createAnimeApi } from "./api";

export default defineMbPlugin({
  meta: {
    title: "番剧",
    emoji: "📺",
    description: "每日放送时间表",
    category: "video",
    version: "0.2.3",
  },
  apply(ctx) {
    const api = createAnimeApi(ctx);
    ctx.registerFeature({
      component: () => <AnimePage api={api} />,
      area: "library",
    });
  },
});
