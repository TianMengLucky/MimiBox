"use no memo";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@heroui/react";
import { Icon } from "@iconify/react";
import { errorMessage } from "@lib/errors";
import CommentCard from "./CommentCard";
import VideoCard from "./VideoCard";
import { formatCount } from "./format";
import type { BilibiliCommentsApi, ReplyMode } from "./api";
import { PageLoading } from "@components/screen/PageLoading";
import type { CommentItem, VideoSummary, VideosPage } from "./types";

/** 排序展示项：最新/最晚都走 mode=2，最晚仅把已加载评论改为从旧到新展示 */
type SortKey = "hot" | "newest" | "oldest";

const SORT_ITEMS = [
  { key: "hot", label: "最热", icon: "lucide:flame" },
  { key: "newest", label: "最新", icon: "lucide:calendar-days" },
  { key: "oldest", label: "最晚", icon: "lucide:history" },
] as const satisfies ReadonlyArray<{ key: SortKey; label: string; icon: string }>;

/** 点赞数筛选阈值 */
const LIKE_FILTERS = [
  { value: 0, label: "全部" },
  { value: 10, label: "10赞+" },
  { value: 100, label: "100赞+" },
  { value: 1000, label: "千赞" },
];

/** B站评论区页面：选择投稿视频，查看并筛选它的评论 */
export default function BilibiliCommentsPage({ api }: { api: BilibiliCommentsApi }) {
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
  const [sort, setSort] = useState<SortKey>("hot");
  /** 时间排序的翻页游标（mode=2），最热排序走页码不需要 */
  const [nextOffset, setNextOffset] = useState<string | null>(null);

  /** 筛选项：关键词 + 最低点赞 + 过滤灌水 + 只看标记 */
  const [keyword, setKeyword] = useState("");
  const [minLikes, setMinLikes] = useState(0);
  const [hideSpam, setHideSpam] = useState(true);
  const [onlyMarked, setOnlyMarked] = useState(false);

  const loadVideos = useCallback(
    async (target: number) => {
      setVideosLoading(true);
      setVideosError("");
      try {
        setVideosPage(await api.videos(target));
        setPage(target);
      } catch (err) {
        setVideosPage(null);
        setVideosError(errorMessage(err));
      } finally {
        setVideosLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    if (!video && !videosPage && !videosError) void loadVideos(1);
  }, [video, videosPage, videosError, loadVideos]);

  const loadComments = useCallback(
    async (
      target: VideoSummary,
      next: number,
      sortMode: ReplyMode,
      cursor: string | null,
      append: boolean,
    ) => {
      setCommentsLoading(true);
      setCommentsError("");
      try {
        const data = await api.comments(target.aid, next, sortMode, cursor);
        setComments((prev) => (append ? [...prev, ...data.comments] : data.comments));
        setCommentTotal(data.total);
        setCommentPage(next);
        setHasMore(data.hasMore);
        setNextOffset(data.nextOffset);
      } catch (err) {
        setCommentsError(errorMessage(err));
        if (!append) setComments([]);
      } finally {
        setCommentsLoading(false);
      }
    },
    [api],
  );

  /** 标记 / 取消标记：先本地乐观更新，落盘失败则回滚 */
  const toggleMark = useCallback(
    async (rpid: number, marked: boolean) => {
      setComments((prev) =>
        prev.map((c) => (c.rpid === rpid ? { ...c, isMarked: marked } : c)),
      );
      try {
        await api.setMark(rpid, marked);
      } catch {
        setComments((prev) =>
          prev.map((c) => (c.rpid === rpid ? { ...c, isMarked: !marked } : c)),
        );
      }
    },
    [api],
  );

  /** 本地修改评论内容（null=还原原文）：乐观更新，落盘失败回滚 */
  const setEdit = useCallback(
    async (rpid: number, content: string | null) => {
      const prev = comments.find((c) => c.rpid === rpid)?.localEdit ?? null;
      setComments((cs) =>
        cs.map((c) => (c.rpid === rpid ? { ...c, localEdit: content } : c)),
      );
      try {
        await api.setEdit(rpid, content);
      } catch (err) {
        setComments((cs) =>
          cs.map((c) => (c.rpid === rpid ? { ...c, localEdit: prev } : c)),
        );
        setCommentsError(errorMessage(err));
      }
    },
    [comments, api],
  );

  /** 新增本地回复：落盘成功后挂到原评论下方 */
  const addReply = useCallback(
    async (rpid: number, content: string) => {
      try {
        const reply = await api.addReply(rpid, content);
        setComments((cs) =>
          cs.map((c) => (c.rpid === rpid ? { ...c, replies: [...c.replies, reply] } : c)),
        );
      } catch (err) {
        setCommentsError(errorMessage(err));
      }
    },
    [api],
  );

  /** 修改本地回复：乐观更新，落盘失败回滚 */
  const updateReply = useCallback(
    async (id: string, content: string) => {
      const parent = comments.find((c) => c.replies.some((r) => r.id === id));
      const prev = parent?.replies.find((r) => r.id === id)?.content;
      setComments((cs) =>
        cs.map((c) => ({
          ...c,
          replies: c.replies.map((r) => (r.id === id ? { ...r, content } : r)),
        })),
      );
      try {
        await api.updateReply(id, content);
      } catch (err) {
        if (prev !== undefined) {
          setComments((cs) =>
            cs.map((c) => ({
              ...c,
              replies: c.replies.map((r) => (r.id === id ? { ...r, content: prev } : r)),
            })),
          );
        }
        setCommentsError(errorMessage(err));
      }
    },
    [comments, api],
  );

  /** 删除本地回复：乐观更新，落盘失败回滚 */
  const removeReply = useCallback(
    async (id: string) => {
      const parent = comments.find((c) => c.replies.some((r) => r.id === id));
      const prev = parent?.replies.find((r) => r.id === id);
      setComments((cs) =>
        cs.map((c) => ({ ...c, replies: c.replies.filter((r) => r.id !== id) })),
      );
      try {
        await api.removeReply(id);
      } catch (err) {
        if (prev && parent) {
          setComments((cs) =>
            cs.map((c) =>
              c.rpid === parent.rpid ? { ...c, replies: [...c.replies, prev] } : c,
            ),
          );
        }
        setCommentsError(errorMessage(err));
      }
    },
    [comments, api],
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
    setOnlyMarked(false);
    setSort("hot");
    setNextOffset(null);
    void loadComments(target, 1, 3, null, false);
  };

  /** 切换排序：最热↔时间需要重新拉取；最新↔最晚只是同一批数据的展示顺序 */
  const changeSort = (next: SortKey) => {
    if (!video || sort === next) return;
    const modeChanged = sort === "hot" !== (next === "hot");
    setSort(next);
    if (modeChanged) {
      setNextOffset(null);
      void loadComments(video, 1, next === "hot" ? 3 : 2, null, false);
    }
  };

  /** 当前排序对应的接口 mode：最热=3，最新/最晚=2（时间） */
  const replyMode: ReplyMode = sort === "hot" ? 3 : 2;

  /** 客户端筛选：关键词（昵称或显示内容，含本地修改）+ 最低点赞 + 灌水过滤 + 只看标记 */
  const filteredComments = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return comments.filter(
      (c) =>
        c.likes >= minLikes &&
        (!hideSpam || !c.isSpam) &&
        (!onlyMarked || c.isMarked) &&
        (kw === "" ||
          (c.localEdit ?? c.content).toLowerCase().includes(kw) ||
          c.uname.toLowerCase().includes(kw)),
    );
  }, [comments, keyword, minLikes, hideSpam, onlyMarked]);

  /** 展示顺序：最热/最新按接口返回顺序；「最晚」把已加载评论改为从旧到新，置顶始终在前 */
  const displayComments = useMemo(() => {
    if (sort !== "oldest") return filteredComments;
    return [...filteredComments].sort(
      (a, b) =>
        Number(b.isTop) - Number(a.isTop) || a.ctime - b.ctime || a.rpid - b.rpid,
    );
  }, [filteredComments, sort]);

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
          {SORT_ITEMS.map(({ key, label, icon }) => (
            <button
              key={key}
              type="button"
              aria-pressed={sort === key}
              title={
                key === "oldest"
                  ? "在已加载的评论里从旧到新排列（置顶除外）"
                  : undefined
              }
              className={
                sort === key
                  ? "flex items-center gap-1.5 rounded-full border border-white/70 bg-white px-4 py-1.5 text-sm font-bold text-[#66535a] shadow-[0_2px_8px_rgb(133_77_96/14%)]"
                  : "flex items-center gap-1.5 rounded-full border border-white/55 bg-white/45 px-4 py-1.5 text-sm font-semibold text-[#9b8a91] hover:text-[#66535a]"
              }
              onClick={() => changeSort(key)}
            >
              <Icon icon={icon} width="14" height="14" aria-hidden="true" />
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

          <button
            type="button"
            aria-pressed={onlyMarked}
            title="只显示已标记的评论"
            className={
              onlyMarked
                ? "flex items-center gap-1.5 rounded-full border border-[#fb7299]/45 bg-[#fb7299]/15 px-4 py-1.5 text-sm font-bold text-[#fb7299] shadow-[0_2px_8px_rgb(251_114_153/18%)]"
                : "flex items-center gap-1.5 rounded-full border border-white/55 bg-white/45 px-4 py-1.5 text-sm font-semibold text-[#9b8a91] hover:text-[#66535a]"
            }
            onClick={() => setOnlyMarked((prev) => !prev)}
          >
            <Icon
              icon="lucide:bookmark"
              width="14"
              height="14"
              aria-hidden="true"
              className={onlyMarked ? "fill-current" : ""}
            />
            只看标记
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
              onRetry={() => void loadComments(video, 1, replyMode, null, false)}
            />
            {!commentsLoading && !commentsError && displayComments.length === 0 && (
              <p className="m-0 py-12 text-center text-sm text-[#9b8a91]">
                {comments.length === 0
                  ? "这个视频还没有评论"
                  : onlyMarked && !comments.some((c) => c.isMarked)
                    ? "还没有标记任何评论，点击评论右下角的「标记」按钮即可收藏"
                    : "没有符合筛选条件的评论"}
              </p>
            )}
            {displayComments.length > 0 && (
              <>
                <ul
                  aria-label="评论列表"
                  className="m-0 flex list-none flex-col gap-3 overflow-y-auto p-0 pb-1"
                >
                  {displayComments.map((comment) => (
                    <CommentCard
                      key={comment.rpid}
                      api={api}
                      comment={comment}
                      aid={video.aid}
                      onToggleMark={toggleMark}
                      onSetEdit={setEdit}
                      onAddReply={addReply}
                      onUpdateReply={updateReply}
                      onRemoveReply={removeReply}
                    />
                  ))}
                </ul>
                <div className="flex justify-center pt-2">
                  {hasMore ? (
                    <Button
                      variant="tertiary"
                      size="sm"
                      isDisabled={commentsLoading}
                      onPress={() =>
                        void loadComments(video, commentPage + 1, replyMode, nextOffset, true)
                      }
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
    return <PageLoading label={loadingText} />;
  }
  if (error) {
    return (
      <div className="page-in flex flex-1 flex-col items-center justify-center gap-3 text-center">
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
