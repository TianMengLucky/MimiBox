/** B 站投稿插件前端入口：注册功能页面（卡片元数据来自 plugin.json 清单） */
import { defineMbPlugin } from "mb-host";
import BilibiliUploadPage from "./BilibiliUploadPage";
import { createBilibiliUploadApi } from "./api";

export default defineMbPlugin({
  meta: {
    title: "B站投稿",
    emoji: "📺",
    description: "上传视频一键投稿",
    category: "video",
    version: "0.2.3",
  },
  apply(ctx) {
    const api = createBilibiliUploadApi(ctx);
    ctx.registerFeature({
      component: () => <BilibiliUploadPage api={api} />,
    });
  },
});
