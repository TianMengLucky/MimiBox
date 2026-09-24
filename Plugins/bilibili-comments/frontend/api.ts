/** B站评论区插件 API：把宿主上下文的 invoke 包装成本插件后端命令的类型化方法 */
import { hasTauri } from "@lib/tauriInvoke";
import type { MbPluginContext } from "mb-host";
import type { CommentsPage, LocalReply, RepliesPage, VideosPage } from "./types";

/** B 站 reply 接口的排序 mode：3=最热（默认）2=按时间 */
export type ReplyMode = 2 | 3;

/** 浏览器开发预览时的空数据默认值 */
const EMPTY_VIDEOS: VideosPage = { videos: [], page: 1, pageCount: 1, total: 0 };
const EMPTY_COMMENTS: CommentsPage = {
  comments: [],
  total: 0,
  hasMore: false,
  nextOffset: null,
};
const EMPTY_REPLIES: RepliesPage = { replies: [], total: 0 };

export function createBilibiliCommentsApi(ctx: MbPluginContext) {
  /** 应用内正常调用（失败向上抛给页面展示）；浏览器开发预览返回默认值渲染 UI */
  async function invokeWithDefault<T>(
    command: string,
    args: Record<string, unknown>,
    defaultValue: T,
  ): Promise<T> {
    if (!hasTauri) return defaultValue;
    return ctx.invoke<T>(command, args);
  }

  return {
    /** 分页拉取当前账号的投稿视频列表 */
    videos(page: number): Promise<VideosPage> {
      return invokeWithDefault("bilibili_comments_videos", { page }, EMPTY_VIDEOS);
    },

    /** 分页拉取视频评论区（mode：3=最热 2=按时间；nextOffset 为时间排序游标） */
    comments(
      aid: number,
      page: number,
      mode: ReplyMode,
      nextOffset: string | null,
    ): Promise<CommentsPage> {
      return invokeWithDefault(
        "bilibili_comments_list",
        { aid, page, mode, nextOffset },
        EMPTY_COMMENTS,
      );
    },

    /** 分页拉取评论楼中楼 */
    replies(oid: number, root: number, page: number): Promise<RepliesPage> {
      return invokeWithDefault(
        "bilibili_comments_replies",
        { oid, root, page },
        EMPTY_REPLIES,
      );
    },

    /** 标记 / 取消标记评论（持久化到 comment_marks.json） */
    setMark(rpid: number, marked: boolean): Promise<void> {
      return ctx.invoke<void>("bilibili_comments_set_mark", { rpid, marked });
    },

    /** 本地修改评论内容（content=null 还原原文，持久化到 comment_notes.json） */
    setEdit(rpid: number, content: string | null): Promise<void> {
      return ctx.invoke<void>("bilibili_comments_set_edit", { rpid, content });
    },

    /** 新增仅本地显示的回复，返回落盘后的完整回复 */
    addReply(parentRpid: number, content: string): Promise<LocalReply> {
      return ctx.invoke<LocalReply>("bilibili_comments_add_reply", {
        parentRpid,
        content,
      });
    },

    /** 修改本地回复内容 */
    updateReply(id: string, content: string): Promise<void> {
      return ctx.invoke<void>("bilibili_comments_update_reply", { id, content });
    },

    /** 删除本地回复 */
    removeReply(id: string): Promise<void> {
      return ctx.invoke<void>("bilibili_comments_remove_reply", { id });
    },
  };
}

/** B站评论区插件 API 类型（页面与组件经 props 接收） */
export type BilibiliCommentsApi = ReturnType<typeof createBilibiliCommentsApi>;
