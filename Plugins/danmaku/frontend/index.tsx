/** 弹幕直播姬插件前端入口：注册功能页与独立窗口页（卡片元数据来自 plugin.json 清单） */
import { defineMbPlugin } from "mb-host";
import DanmakuPage from "./DanmakuPage";
import DanmakuWindowPage from "./DanmakuWindowPage";
import { createDanmakuApi } from "./api";

export default defineMbPlugin({
  meta: {
    title: "弹幕直播姬",
    emoji: "🎀",
    description: "连接直播间实时弹幕",
    category: "video",
    version: "0.2.3",
  },
  apply(ctx) {
    const api = createDanmakuApi(ctx);
    ctx.registerFeature({
      component: () => <DanmakuPage api={api} />,
      windowComponent: () => <DanmakuWindowPage api={api} />,
    });
  },
});
