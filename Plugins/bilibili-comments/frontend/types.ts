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

/** 评论里的 B 站表情（[dog] 等），渲染时替换 message 里的同名文本 */
export type BiliEmote = {
  /** 表情文本，如 "[dog]" */
  text: string;
  url: string;
  /** 尺寸档位（1=小 2=大 3=超大） */
  size: number;
};

/** 图片评论里的图片 */
export type BiliPicture = {
  url: string;
  width: number;
  height: number;
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
  /** B 站回复总数（楼中楼条数，不含主楼） */
  replyCount: number;
  /** 评论内表情：content 里 [xxx] 文本对应这里的图片 */
  emotes: BiliEmote[];
  /** 图片评论的图片列表 */
  pictures: BiliPicture[];
  /** 是否灌水评论（纯表情/复读/口癖），由 Rust 端解析时计算 */
  isSpam: boolean;
  /** 是否被用户标记，由 Rust 端按持久化标记集合注入 */
  isMarked: boolean;
  /** 本地修改后的内容（仅本地存储与显示），null 表示未修改 */
  localEdit: string | null;
  /** 本地回复（仅本地存储与显示），挂在原评论下方 */
  replies: LocalReply[];
};

/** 回复楼中楼的分页结果（复用 CommentItem 结构，本地字段为默认值） */
export type RepliesPage = {
  replies: CommentItem[];
  total: number;
};

export type CommentsPage = {
  comments: CommentItem[];
  total: number;
  hasMore: boolean;
  /** 时间排序（mode=2）的翻页游标，下次请求原样回传；null 表示没有下一页 */
  nextOffset: string | null;
};
