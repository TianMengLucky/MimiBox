/** 抽奖插件前端入口：注册功能页面（卡片元数据来自 plugin.json 清单） */
import { defineMbPlugin } from "mb-host";
import LotteryPage from "./LotteryPage";
import { createLotteryStore } from "./store";

export default defineMbPlugin({
  meta: {
    title: "抽奖",
    emoji: "🎁",
    description: "幸运转盘",
    category: "fun",
    version: "0.2.3",
  },
  apply(ctx) {
    const store = createLotteryStore(ctx);
    ctx.registerFeature({
      component: () => <LotteryPage store={store} />,
    });
  },
});
