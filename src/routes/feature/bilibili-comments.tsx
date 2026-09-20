"use no memo";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Spinner } from "@heroui/react";
import { Icon } from "@iconify/react";
import { createFileRoute } from "@tanstack/react-router";
import { tauriInvoke } from "../../lib/tauriInvoke";
import CommentCard from "@components/bilibili-comments/CommentCard";
import VideoCard from "@components/bilibili-comments/VideoCard";
import { formatCount } from "@components/bilibili-comments/format";
import type { CommentItem, VideoSummary, VideosPage } from "@components/bilibili-comments/types";

export const Route = createFileRoute("/feature/bilibili-comments")({
  component: BilibiliCommentsRoute,
});

/** 评论排序：2=最热（点赞）3=最新（时间），对应 reply 接口的 mode */
type ReplyMode = 2 | 3;

/** 点赞数筛选阈值 */
const LIKE_FILTERS = [
  { value: 0, label: "全部" },
  { value: 10, label: "10赞+" },
  { value: 100, label: "100赞+" },
  { value: 1000, label: "千赞" },
];

/** 浏览器开发预览时的空数据默认值 */
const EMPTY_VIDEOS: VideosPage = { videos: [], page: 1, pageCount: 1, total: 0 };
const EMPTY_COMMENTS = { comments: [] as CommentItem[], total: 0, hasMore: false };

async function fetchVideos(page: number): Promise<VideosPage> {
  return tauriInvoke<VideosPage>("bilibili_comments_videos", { page }, {
    defaultValue: EMPTY_VIDEOS,
  });
}

async function fetchComments(aid: number, page: number, mode: ReplyMode) {
  return tauriInvoke<{ comments: CommentItem[]; total: number; hasMore: boolean }>(
    "bilibili_comments_list",
    { aid, page, mode },
    { defaultValue: EMPTY_COMMENTS },
  );
}

function BilibiliCommentsRoute() {
  const [video, setVideo] = useState<VideoSummary | null>(null);
  const [videosPage, setVideosPage] = useState<VideosPage | null>(null);
  const [videosLoading, setVideosLoading] = useState(true);
  const [videosError, setVideosError] = useState("");
  const [page, setPage] = useState(1);

  const [comments, setComments] = useState<CommentItem[]>([]);
  const [commentTotal, setCommentTotal] = useState(0);
  const [commentPage, setCommentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState("");
  const [mode, setMode] = useState<ReplyMode>(2);

  /** 筛选项：关键词 + 最低点赞 + 过滤灌水 */
  const [keyword, setKeyword] = useState("");
  const [minLikes, setMinLikes] = useState(0);
  const [hideSpam, setHideSpam] = useState(true);

  const loadVideos = useCallback(async (target: number) => {
    setVideosLoading(true);
    setVideosError("");
    try {
      setVideosPage(await fetchVideos(target));
      setPage(target);
    } catch (err) {
      setVideosPage(null);
      setVideosError(err instanceof Error ? err.message : String(err));
    } finally {
      setVideosLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!video && !videosPage && !videosError) void loadVideos(1);
  }, [video, videosPage, videosError, loadVideos]);

  const loadComments = useCallback(
    async (target: VideoSummary, next: number, sortMode: ReplyMode, append: boolean) => {
      setCommentsLoading(true);
      setCommentsError("");
      try {
        const data = await fetchComments(target.aid, next, sortMode);
        setComments((prev) => (append ? [...prev, ...data.comments] : data.comments));
        setCommentTotal(data.total);
        setCommentPage(next);
        setHasMore(data.hasMore);
      } catch (err) {
        setCommentsError(err instanceof Error ? err.message : String(err));
        if (!append) setComments([]);
      } finally {
        setCommentsLoading(false);
      }
    },
    [],
  );

  /** 选中视频：进入评论区并重置筛选 */
  const openComments = (target: VideoSummary) => {
    setVideo(target);
    setComments([]);
    setCommentTotal(0);
    setCommentPage(1);
    setHasMore(false);
    setKeyword("");
    setMinLikes(0);
    setHideSpam(true);
    setMode(2);
    void loadComments(target, 1, 2, false);
  };

  /** 切换排序：从第一页重新拉取 */
  const changeMode = (next: ReplyMode) => {
    if (!video || mode === next) return;
    setMode(next);
    void loadComments(video, 1, next, false);
  };

  /** 客户端筛选：关键词（昵称或内容）+ 最低点赞 + 灌水过滤 */
  const filteredComments = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return comments.filter(
      (c) =>
        c.likes >= minLikes &&
        (!hideSpam || !c.isSpam) &&
        (kw === "" ||
          c.content.toLowerCase().includes(kw) ||
          c.uname.toLowerCase().includes(kw)),
    );
  }, [comments, keyword, minLikes, hideSpam]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {video ? (
        <CommentsHeader
          video={video}
          total={commentTotal}
          onBack={() => {
            setVideo(null);
            void loadVideos(page);
          }}
        />
      ) : (
        <header>
          <h1 className="m-0 flex items-center gap-2 text-xl font-extrabold tracking-tight text-[#66535a]">
            B站评论区
          </h1>
          <p className="m-0 mt-1 text-sm text-[#9b8a91]">
            选择你的一个投稿视频，查看并筛选它的评论。
          </p>
        </header>
      )}

      {video && (
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label="评论筛选"
        >
          {(
            [
              { value: 2 as ReplyMode, label: "最热" },
              { value: 3 as ReplyMode, label: "最新" },
            ] as const
          ).map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              className={
                mode === value
                  ? "flex items-center gap-1.5 rounded-full border border-white/70 bg-white px-4 py-1.5 text-sm font-bold text-[#66535a] shadow-[0_2px_8px_rgb(133_77_96/14%)]"
                  : "flex items-center gap-1.5 rounded-full border border-white/55 bg-white/45 px-4 py-1.5 text-sm font-semibold text-[#9b8a91] hover:text-[#66535a]"
              }
              onClick={() => changeMode(value)}
            >
              <Icon
                icon={value === 2 ? "lucide:flame" : "lucide:calendar-days"}
                width="14"
                height="14"
                aria-hidden="true"
              />
              {label}
            </button>
          ))}

          <button
            type="button"
            aria-pressed={hideSpam}
            title="隐藏纯表情、单字复读、打卡口癖等无实质内容的评论"
            className={
              hideSpam
                ? "flex items-center gap-1.5 rounded-full border border-white/70 bg-white px-4 py-1.5 text-sm font-bold text-[#66535a] shadow-[0_2px_8px_rgb(133_77_96/14%)]"
                : "flex items-center gap-1.5 rounded-full border border-white/55 bg-white/45 px-4 py-1.5 text-sm font-semibold text-[#9b8a91] hover:text-[#66535a]"
            }
            onClick={() => setHideSpam((prev) => !prev)}
          >
            <Icon icon="lucide:filter" width="14" height="14" aria-hidden="true" />
            过滤灌水
          </button>

          <label className="flex min-w-40 flex-1 items-center gap-1.5 rounded-full border border-white/55 bg-white/60 px-3 py-1.5 sm:max-w-64">
            <Icon icon="lucide:search" width="15" height="15" aria-hidden="true" className="shrink-0 text-[#9b8a91]" />
            <input
              type="search"
              placeholder="筛选评论内容或昵称…"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              className="w-full bg-transparent text-sm text-[#66535a] outline-none placeholder:text-[#bfa9b2]"
            />
          </label>

          <label className="flex items-center gap-1.5">
            <span className="sr-only">按点赞数筛选</span>
            <select
              value={minLikes}
              onChange={(event) => setMinLikes(Number(event.target.value))}
              className="cursor-pointer rounded-full border border-white/55 bg-white/60 px-3 py-1.5 text-sm font-semibold text-[#66535a] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fb7299]"
            >
              {LIKE_FILTERS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div aria-live="polite" className="flex min-h-0 flex-1 flex-col">
        {!video && (videosLoading || videosError) && (
          <LoadingError
            loading={videosLoading}
            error={videosError}
            loadingText="正在获取视频列表…"
            onRetry={() => void loadVideos(1)}
          />
        )}

        {!video && !videosLoading && !videosError && videosPage && (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <p className="m-0 text-xs text-[#9b8a91]">共 {videosPage.total} 个稿件</p>
            <ul
              aria-label="视频列表"
              className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4 overflow-y-auto p-0 pb-1"
            >
              {videosPage.videos.map((item) => (
                <VideoCard key={item.aid} video={item} onSelect={openComments} />
              ))}
            </ul>
            <div className="flex items-center justify-center gap-2 pt-1">
              <Button
                variant="tertiary"
                size="sm"
                isDisabled={videosPage.page <= 1 || videosLoading}
                onPress={() => void loadVideos(videosPage.page - 1)}
              >
                <Icon icon="lucide:chevron-left" width="15" height="15" aria-hidden="true" />
                上一页
              </Button>
              <span className="text-xs text-[#9b8a91]">
                {videosPage.page} / {Math.max(videosPage.pageCount, 1)}
              </span>
              <Button
                variant="tertiary"
                size="sm"
                isDisabled={
                  videosPage.page >= videosPage.pageCount || videosLoading
                }
                onPress={() => void loadVideos(videosPage.page + 1)}
              >
                下一页
                <Icon icon="lucide:chevron-right" width="15" height="15" aria-hidden="true" />
              </Button>
            </div>
          </div>
        )}

        {video && (
          <div className="flex min-h-0 flex-1 flex-col">
            <LoadingError
              loading={commentsLoading && comments.length === 0}
              error={commentsError}
              loadingText="正在获取评论…"
              onRetry={() => void loadComments(video, 1, mode, false)}
            />
            {!commentsLoading && !commentsError && filteredComments.length === 0 && (
              <p className="m-0 py-12 text-center text-sm text-[#9b8a91]">
                {comments.length === 0 ? "这个视频还没有评论" : "没有符合筛选条件的评论"}
              </p>
            )}
            {filteredComments.length > 0 && (
              <>
                <ul
                  aria-label="评论列表"
                  className="m-0 flex list-none flex-col gap-3 overflow-y-auto p-0 pb-1"
                >
                  {filteredComments.map((comment) => (
                    <CommentCard key={comment.rpid} comment={comment} />
                  ))}
                </ul>
                <div className="flex justify-center pt-2">
                  {hasMore ? (
                    <Button
                      variant="tertiary"
                      size="sm"
                      isDisabled={commentsLoading}
                      onPress={() => void loadComments(video, commentPage + 1, mode, true)}
                    >
                      {commentsLoading ? "正在加载…" : "加载更多"}
                    </Button>
                  ) : (
                    <p className="m-0 text-xs text-[#9b8a91]">
                      已加载 {comments.length} / {formatCount(Math.max(commentTotal, comments.length))} 条评论
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** 评论区视图头部：返回按钮 + 视频标题 + 评论总数 */
function CommentsHeader({
  video,
  total,
  onBack,
}: {
  video: VideoSummary;
  total: number;
  onBack: () => void;
}) {
  return (
    <header className="flex items-center gap-3">
      <Button
        variant="tertiary"
        size="sm"
        onPress={onBack}
        aria-label="返回视频列表"
        className="shrink-0 rounded-full font-semibold"
      >
        <Icon icon="lucide:chevron-left" width="16" height="16" aria-hidden="true" />
        换一个视频
      </Button>
      <div className="min-w-0">
        <h1 className="m-0 line-clamp-1 text-base font-extrabold tracking-tight text-[#66535a]">
          {video.title}
        </h1>
        <p className="m-0 mt-0.5 text-xs text-[#9b8a91]">
          {formatCount(Math.max(total, video.comment))} 条评论
        </p>
      </div>
    </header>
  );
}

/** 加载中 / 出错占位（视频列表与评论区共用） */
function LoadingError({
  loading,
  error,
  loadingText,
  onRetry,
}: {
  loading: boolean;
  error: string;
  loadingText: string;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-[#9b8a91]">
        <Spinner size="lg" color="accent" />
        {loadingText}
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <Icon
          icon="lucide:circle-off"
          width="36"
          height="36"
          aria-hidden="true"
          className="text-[#d8c7cf]"
        />
        <p className="m-0 max-w-sm text-sm break-all text-[#9b8a91]">获取失败：{error}</p>
        <Button variant="primary" size="sm" onPress={onRetry} className="rounded-full px-5 font-semibold">
          <Icon icon="lucide:refresh-cw" width="16" height="16" aria-hidden="true" />
          重试
        </Button>
      </div>
    );
  }
  return null;
}
