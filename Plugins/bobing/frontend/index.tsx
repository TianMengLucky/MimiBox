/** 博饼插件前端入口：注册功能页面（卡片元数据来自 plugin.json 清单） */
import { defineMbPlugin } from "mb-host";
import BobingPage from "./BobingPage";
import { createBobingStore } from "./store";

export default defineMbPlugin({
  meta: {
    title: "博饼",
    emoji: "🎲",
    description: "掷骰夺状元",
    category: "fun",
    version: "0.2.3",
  },
  apply(ctx) {
    const store = createBobingStore(ctx);
    ctx.registerFeature({
      component: () => <BobingPage store={store} />,
    });
  },
});
