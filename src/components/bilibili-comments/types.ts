/** B 站评论区功能的前端类型（与 Rust 端 DTO 对应，camelCase） */

export type VideoSummary = {
  aid: number;
  bvid: string;
  title: string;
  cover: string;
  /** 发布时间（Unix 秒） */
  created: number;
  /** 时长文本，如 "12:34" */
  duration: string;
  play: number;
  comment: number;
};

export type VideosPage = {
  videos: VideoSummary[];
  page: number;
  pageCount: number;
  total: number;
};

/** 仅本地存储与显示的评论回复（不会同步到 B 站） */
export type LocalReply = {
  id: string;
  content: string;
  /** 创建时间（Unix 秒） */
  createdAt: number;
};

export type CommentItem = {
  rpid: number;
  mid: number;
  uname: string;
  avatar: string;
  level: number;
  content: string;
  likes: number;
  ctime: number;
  isTop: boolean;
  /** 是否灌水评论（纯表情/复读/口癖），由 Rust 端解析时计算 */
  isSpam: boolean;
  /** 是否被用户标记，由 Rust 端按持久化标记集合注入 */
  isMarked: boolean;
  /** 本地修改后的内容（仅本地存储与显示），null 表示未修改 */
  localEdit: string | null;
  /** 本地回复（仅本地存储与显示），挂在原评论下方 */
  replies: LocalReply[];
};

export type CommentsPage = {
  comments: CommentItem[];
  total: number;
  hasMore: boolean;
  /** 时间排序（mode=2）的翻页游标，下次请求原样回传；null 表示没有下一页 */
  nextOffset: string | null;
};
