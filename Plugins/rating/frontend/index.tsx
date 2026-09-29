/** 评分插件前端入口：注册功能页面（卡片元数据来自 plugin.json 清单） */
import { defineMbPlugin } from "mb-host";
import RatingPage from "./RatingPage";
import { createRatingStore } from "./store";

export default defineMbPlugin({
  meta: {
    title: "评分",
    emoji: "⭐",
    description: "批量打 1-10 分",
    category: "video",
    version: "0.2.3",
  },
  apply(ctx) {
    const store = createRatingStore(ctx);
    ctx.registerFeature({
      component: () => <RatingPage store={store} />,
    });
  },
});
