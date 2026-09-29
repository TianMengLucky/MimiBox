/** 白板插件前端入口：注册功能页面（卡片元数据来自 plugin.json 清单） */
import { defineMbPlugin } from "mb-host";
import WhiteboardPage from "./WhiteboardPage";
import { createWhiteboardStore } from "./store";

export default defineMbPlugin({
  meta: {
    title: "白板",
    emoji: "🖼️",
    description: "背景图上自由摆放贴图",
    category: "video",
    version: "0.2.3",
  },
  apply(ctx) {
    const store = createWhiteboardStore(ctx);
    ctx.registerFeature({
      component: () => <WhiteboardPage store={store} />,
    });
  },
});
