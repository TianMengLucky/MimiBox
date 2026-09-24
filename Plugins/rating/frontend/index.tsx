/** 评分插件前端入口：注册功能页面（卡片元数据来自 plugin.json 清单） */
import { defineMbPlugin } from "mb-host";
import RatingPage from "./RatingPage";
import { createRatingStore } from "./store";

export default defineMbPlugin({
  apply(ctx) {
    const store = createRatingStore(ctx);
    ctx.registerFeature({
      component: () => <RatingPage store={store} />,
    });
  },
});
