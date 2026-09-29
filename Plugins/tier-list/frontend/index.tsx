/** 夯到拉插件前端入口：注册功能页面（卡片元数据来自 plugin.json 清单） */
import { defineMbPlugin } from "mb-host";
import TierListPage from "./TierListPage";
import { createTierListStore } from "./store";

export default defineMbPlugin({
  meta: {
    title: "夯到拉",
    emoji: "🏆",
    description: "图片排名表",
    category: "video",
    version: "0.2.3",
  },
  apply(ctx) {
    const store = createTierListStore(ctx);
    ctx.registerFeature({
      component: () => <TierListPage store={store} />,
    });
  },
});
