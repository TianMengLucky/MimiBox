/** B站评论区插件前端入口：注册功能页面（卡片元数据来自 plugin.json 清单） */
import { defineMbPlugin } from "mb-host";
import BilibiliCommentsPage from "./BilibiliCommentsPage";
import { createBilibiliCommentsApi } from "./api";

export default defineMbPlugin({
  apply(ctx) {
    const api = createBilibiliCommentsApi(ctx);
    ctx.registerFeature({
      component: () => <BilibiliCommentsPage api={api} />,
    });
  },
});
