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
};

export type CommentsPage = {
  comments: CommentItem[];
  total: number;
  hasMore: boolean;
};
