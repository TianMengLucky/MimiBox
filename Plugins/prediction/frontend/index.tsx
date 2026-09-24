/** 赛事预测插件前端入口：注册功能页面（卡片元数据来自 plugin.json 清单） */
import { defineMbPlugin } from "mb-host";
import PredictionPage from "./PredictionPage";
import { createPredictionStore } from "./store";

export default defineMbPlugin({
  apply(ctx) {
    const store = createPredictionStore(ctx);
    ctx.registerFeature({
      component: () => <PredictionPage store={store} />,
    });
  },
});
