"use no memo";

import { useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "@iconify/react";
import { errorMessage } from "@lib/errors";
import type { BilibiliCommentsApi } from "./api";
import { formatCount, formatRelative } from "./format";
import type { BiliEmote, BiliPicture, CommentItem, LocalReply } from "./types";

/** 硬币等级徽章配色：0-1 灰 / 2-3 绿 / 4-5 琥珀 / 6+ B 站粉 */
function levelBadgeClass(level: number): string {
  if (level >= 6) return "bg-[#fb7299] text-white";
  if (level >= 4) return "bg-[#f5b544] text-[#6b4a12]";
  if (level >= 2) return "bg-[#95de64] text-[#2f6b3a]";
  return "bg-[#e3d3da] text-[#9b8a91]";
}

/** 操作栏幽灵按钮（回复/修改/还原/标记共用） */
function actionButtonClass(active?: boolean): string {
  return active
    ? "flex items-center gap-1 rounded-full border border-transparent bg-[#fb7299]/15 px-2 py-0.5 font-bold text-[#fb7299] shadow-none transition-colors hover:bg-[#fb7299]/25"
    : "flex items-center gap-1 rounded-full border border-transparent bg-transparent px-2 py-0.5 font-semibold text-[#9b8a91] shadow-none transition-colors hover:bg-white/70 hover:text-[#66535a]";
}

/** 本地输入区（修改评论 / 写回复 / 改回复）共用的多行文本框 */
const textareaClass =
  "w-full resize-y rounded-xl border border-white/70 bg-white/85 p-2.5 text-sm leading-relaxed text-[#66535a] outline-none placeholder:text-[#bfa9b2] focus:border-[#fb7299]/50";

/** 表情尺寸档位：1=小(24px) 2=大(40px) 3=超大(64px) */
function emoteClass(size: number): string {
  if (size >= 3) return "h-16 max-w-24 w-auto";
  if (size === 2) return "h-10 w-auto";
  return "h-6 w-auto";
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 把 message 里的 [表情] 文本替换为 B 站表情图片；无表情时返回原文 */
function renderMessage(content: string, emotes: BiliEmote[]): ReactNode {
  if (emotes.length === 0) return content;
  const map = new Map(emotes.map((emote) => [emote.text, emote]));
  const pattern = emotes.map((emote) => escapeRegExp(emote.text)).join("|");
  let regex: RegExp;
  try {
    regex = new RegExp(`(${pattern})`, "g");
  } catch {
    return content;
  }
  return content
    .split(regex)
    .map((part, index) => {
      const emote = map.get(part);
      if (!emote) return <span key={index}>{part}</span>;
      return (
        <img
          key={index}
          src={emote.url}
          alt={emote.text}
          title={emote.text}
          loading="lazy"
          referrerPolicy="no-referrer"
          className={`inline-block align-text-bottom ${emoteClass(emote.size)}`}
        />
      );
    });
}

/** 图片评论的图片列表（多图换行平铺，单图限制最大宽度） */
function PictureList({ pictures }: { pictures: BiliPicture[] }) {
  if (pictures.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {pictures.map((pic) => (
        <img
          key={pic.url}
          src={pic.url}
          alt="评论图片"
          loading="lazy"
          referrerPolicy="no-referrer"
          className={
            pictures.length === 1
              ? "max-h-72 max-w-full rounded-xl border border-white/70 bg-white/60 object-contain"
              : "h-40 w-auto max-w-full rounded-lg border border-white/70 bg-white/60 object-cover"
          }
        />
      ))}
    </div>
  );
}

/** 评论正文（含表情替换与图片展示），修改后的文本也复用同一渲染 */
function CommentBody({ content, emotes, pictures }: { content: string; emotes: BiliEmote[]; pictures: BiliPicture[] }) {
  return (
    <>
      <p className="m-0 mt-1.5 text-sm leading-relaxed break-words whitespace-pre-wrap text-[#66535a]">
        {renderMessage(content, emotes)}
      </p>
      <PictureList pictures={pictures} />
    </>
  );
}

/** 单条评论：圆头像 + 昵称 + 等级徽章 + 时间 + 内容 + 点赞 + 标记 +
 *  B 站回复楼中楼 + 仅本地的修改与回复（修改覆盖显示原内容） */
export default function CommentCard({
  api,
  comment,
  aid,
  onToggleMark,
  onSetEdit,
  onAddReply,
  onUpdateReply,
  onRemoveReply,
}: {
  /** 插件 API（拉取楼中楼用） */
  api: BilibiliCommentsApi;
  comment: CommentItem;
  /** 评论所属视频的 aid（拉取楼中楼用） */
  aid: number;
  onToggleMark: (rpid: number, marked: boolean) => void;
  onSetEdit: (rpid: number, content: string | null) => void;
  onAddReply: (rpid: number, content: string) => void;
  onUpdateReply: (id: string, content: string) => void;
  onRemoveReply: (id: string) => void;
}) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const [showOriginal, setShowOriginal] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyDraft, setReplyDraft] = useState("");

  /** B 站回复楼中楼（按需从 reply/reply 接口分页拉取） */
  const [thread, setThread] = useState<CommentItem[]>([]);
  const [threadTotal, setThreadTotal] = useState(0);
  const [threadPage, setThreadPage] = useState(0);
  const [threadOpen, setThreadOpen] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState("");

  const hasEdit = comment.localEdit != null;
  const displayedContent = comment.localEdit ?? comment.content;

  const startEdit = () => {
    setEditDraft(displayedContent);
    setEditing(true);
  };
  const saveEdit = () => {
    const text = editDraft.trim();
    if (!text) return;
    // 改回与原文一致时视同还原，不再保留覆盖条目
    onSetEdit(comment.rpid, text === comment.content ? null : text);
    setEditing(false);
    setShowOriginal(false);
  };
  const submitReply = () => {
    const text = replyDraft.trim();
    if (!text) return;
    onAddReply(comment.rpid, text);
    setReplyDraft("");
    setReplyOpen(false);
  };

  /** 拉取楼中楼（append=false 首次加载，true 加载下一页） */
  const loadThread = async (page: number, append: boolean) => {
    setThreadLoading(true);
    setThreadError("");
    try {
      const data = await api.replies(aid, comment.rpid, page);
      setThread((prev) => (append ? [...prev, ...data.replies] : data.replies));
      setThreadTotal(data.total);
      setThreadPage(page);
      setThreadOpen(true);
    } catch (err) {
      setThreadError(errorMessage(err));
    } finally {
      setThreadLoading(false);
    }
  };

  return (
    <li
      className={
        comment.isMarked
          ? "flex gap-3 rounded-2xl border border-[#fb7299]/45 bg-[#fff4f8]/80 p-3.5 shadow-[0_4px_18px_rgb(251_114_153/18%)]"
          : "flex gap-3 rounded-2xl border border-white/55 bg-white/65 p-3.5 shadow-[0_4px_18px_rgb(133_77_96/10%)]"
      }
    >
      <span className="relative h-10 w-10 shrink-0 rounded-full bg-gradient-to-br from-[#ffd9e8] to-[#c9a7dd] p-[2px]">
        {comment.avatar && !avatarFailed ? (
          <img
            src={comment.avatar}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setAvatarFailed(true)}
            className="h-full w-full rounded-full bg-white object-cover"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center rounded-full bg-white">
            <Icon
              icon="lucide:user-round"
              width="18"
              height="18"
              aria-hidden="true"
              className="text-[#d8c7cf]"
            />
          </span>
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-bold text-[#66535a]">{comment.uname}</span>
          <span
            aria-label={`等级 Lv${comment.level}`}
            className={`rounded px-1 py-px text-[10px] leading-tight font-bold italic ${levelBadgeClass(comment.level)}`}
          >
            Lv{comment.level}
          </span>
          {comment.isTop && (
            <span className="flex items-center gap-0.5 rounded-full bg-[#fb7299]/12 px-1.5 py-px text-[10px] font-bold text-[#fb7299]">
              <Icon icon="lucide:party-popper" width="11" height="11" aria-hidden="true" />
              置顶
            </span>
          )}
          {hasEdit && (
            <span
              title="这条评论的内容只在本地被修改显示，未同步到 B 站"
              className="flex items-center gap-0.5 rounded-full bg-[#fb7299]/12 px-1.5 py-px text-[10px] font-bold text-[#fb7299]"
            >
              <Icon icon="lucide:pencil" width="11" height="11" aria-hidden="true" />
              本地修改
            </span>
          )}
          <span className="ml-auto text-xs text-[#9b8a91]">
            {formatRelative(comment.ctime)}
          </span>
        </div>

        {editing ? (
          <div className="mt-1.5 flex flex-col gap-1.5">
            <textarea
              value={editDraft}
              onChange={(event) => setEditDraft(event.target.value)}
              rows={3}
              autoFocus
              className={textareaClass}
            />
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={saveEdit}
                disabled={!editDraft.trim()}
                className="cursor-pointer rounded-full bg-[#f5b3c9] px-3 py-1 font-bold text-[#5e4c53] shadow-none transition-colors hover:bg-[#f8c3d5] disabled:cursor-not-allowed disabled:opacity-50"
              >
                保存
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="cursor-pointer rounded-full bg-transparent px-3 py-1 font-semibold text-[#9b8a91] shadow-none transition-colors hover:text-[#66535a]"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <>
            <CommentBody content={displayedContent} emotes={comment.emotes} pictures={comment.pictures} />
            {hasEdit && showOriginal && (
              <p className="m-0 mt-1 text-xs leading-relaxed break-words whitespace-pre-wrap text-[#9b8a91]">
                原文：{comment.content}
              </p>
            )}
          </>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-[#9b8a91]">
          <span className="flex items-center gap-1">
            <Icon icon="lucide:thumbs-up" width="13" height="13" aria-hidden="true" />
            {comment.likes > 0 ? formatCount(comment.likes) : "赞"}
          </span>
          <button
            type="button"
            onClick={() => setReplyOpen((value) => !value)}
            className={actionButtonClass(replyOpen)}
          >
            <Icon icon="lucide:message-circle" width="13" height="13" aria-hidden="true" />
            回复
          </button>
          <button type="button" onClick={startEdit} className={actionButtonClass()}>
            <Icon icon="lucide:pencil" width="13" height="13" aria-hidden="true" />
            修改
          </button>
          {hasEdit && (
            <>
              <button
                type="button"
                title="显示 B 站上的原始内容"
                onClick={() => setShowOriginal((value) => !value)}
                className={actionButtonClass()}
              >
                <Icon icon="lucide:eye" width="13" height="13" aria-hidden="true" />
                {showOriginal ? "收起原文" : "查看原文"}
              </button>
              <button
                type="button"
                title="去掉本地修改，恢复显示原始内容"
                onClick={() => onSetEdit(comment.rpid, null)}
                className={actionButtonClass()}
              >
                <Icon icon="lucide:eraser" width="13" height="13" aria-hidden="true" />
                还原
              </button>
            </>
          )}
          <button
            type="button"
            aria-pressed={comment.isMarked}
            title={comment.isMarked ? "取消标记" : "标记这条评论"}
            onClick={() => onToggleMark(comment.rpid, !comment.isMarked)}
            className={actionButtonClass(comment.isMarked)}
          >
            <Icon
              icon="lucide:bookmark"
              width="13"
              height="13"
              aria-hidden="true"
              className={comment.isMarked ? "fill-current" : ""}
            />
            {comment.isMarked ? "已标记" : "标记"}
          </button>
        </div>

        {replyOpen && (
          <div className="mt-2 flex flex-col gap-1.5">
            <textarea
              value={replyDraft}
              onChange={(event) => setReplyDraft(event.target.value)}
              rows={2}
              placeholder="写下仅本地显示的回复…"
              className={textareaClass}
            />
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={submitReply}
                disabled={!replyDraft.trim()}
                className="cursor-pointer rounded-full bg-[#f5b3c9] px-3 py-1 font-bold text-[#5e4c53] shadow-none transition-colors hover:bg-[#f8c3d5] disabled:cursor-not-allowed disabled:opacity-50"
              >
                回复
              </button>
              <button
                type="button"
                onClick={() => setReplyOpen(false)}
                className="cursor-pointer rounded-full bg-transparent px-3 py-1 font-semibold text-[#9b8a91] shadow-none transition-colors hover:text-[#66535a]"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {comment.replyCount > 0 && (
          <div className="mt-2">
            <button
              type="button"
              aria-expanded={threadOpen}
              disabled={threadLoading}
              onClick={() => {
                if (threadOpen) {
                  setThreadOpen(false);
                } else if (thread.length === 0) {
                  void loadThread(1, false);
                } else {
                  setThreadOpen(true);
                }
              }}
              className={actionButtonClass()}
            >
              <Icon
                icon={threadOpen ? "lucide:chevron-up" : "lucide:chevron-down"}
                width="13"
                height="13"
                aria-hidden="true"
              />
              {threadLoading
                ? "正在加载回复…"
                : threadOpen
                  ? "收起回复"
                  : `共 ${formatCount(comment.replyCount)} 条回复`}
            </button>
          </div>
        )}

        {threadOpen && thread.length > 0 && (
          <ul className="m-0 mt-2 flex list-none flex-col gap-2 border-l-2 border-[#e7d5dd] pl-3">
            {thread.map((reply) => (
              <BiliReplyRow key={reply.rpid} reply={reply} />
            ))}
            {thread.length < threadTotal && (
              <li className="pt-0.5">
                <button
                  type="button"
                  disabled={threadLoading}
                  onClick={() => void loadThread(threadPage + 1, true)}
                  className={actionButtonClass()}
                >
                  <Icon icon="lucide:chevron-down" width="13" height="13" aria-hidden="true" />
                  {threadLoading ? "正在加载…" : `加载更多（已显示 ${thread.length}/${threadTotal}）`}
                </button>
              </li>
            )}
          </ul>
        )}
        {threadError && (
          <p className="m-0 mt-1.5 flex items-center gap-1 text-xs text-[#d26d9a]">
            <Icon icon="lucide:circle-alert" width="13" height="13" aria-hidden="true" />
            {threadError}
          </p>
        )}

        {comment.replies.length > 0 && (
          <ul className="m-0 mt-2.5 flex list-none flex-col gap-2 border-l-2 border-[#fb7299]/25 pl-3">
            {comment.replies.map((reply) => (
              <LocalReplyRow
                key={reply.id}
                reply={reply}
                onUpdate={onUpdateReply}
                onRemove={onRemoveReply}
              />
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

/** B 站楼中楼里的一条回复：只读展示（头像 + 昵称 + 内容 + 时间/点赞） */
function BiliReplyRow({ reply }: { reply: CommentItem }) {
  const [avatarFailed, setAvatarFailed] = useState(false);

  return (
    <li className="flex gap-2 rounded-xl border border-white/50 bg-white/55 px-2.5 py-2">
      <span className="h-7 w-7 shrink-0 overflow-hidden rounded-full bg-white">
        {reply.avatar && !avatarFailed ? (
          <img
            src={reply.avatar}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setAvatarFailed(true)}
            className="h-full w-full rounded-full object-cover"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-[#f6eef2]">
            <Icon icon="lucide:user-round" width="14" height="14" aria-hidden="true" className="text-[#d8c7cf]" />
          </span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-xs font-bold text-[#66535a]">{reply.uname}</span>
          <span
            aria-label={`等级 Lv${reply.level}`}
            className={`rounded px-1 py-px text-[10px] leading-tight font-bold italic ${levelBadgeClass(reply.level)}`}
          >
            Lv{reply.level}
          </span>
          <span className="ml-auto text-[11px] text-[#9b8a91]">
            {formatRelative(reply.ctime)}
          </span>
        </div>
        <p className="m-0 mt-1 text-sm leading-relaxed break-words whitespace-pre-wrap text-[#66535a]">
          {renderMessage(reply.content, reply.emotes)}
        </p>
        <PictureList pictures={reply.pictures} />
        {reply.likes > 0 && (
          <span className="mt-1 flex items-center gap-1 text-[11px] text-[#9b8a91]">
            <Icon icon="lucide:thumbs-up" width="12" height="12" aria-hidden="true" />
            {formatCount(reply.likes)}
          </span>
        )}
      </div>
    </li>
  );
}

/** 原评论下方的单条本地回复 */
function LocalReplyRow({
  reply,
  onUpdate,
  onRemove,
}: {
  reply: LocalReply;
  onUpdate: (id: string, content: string) => void;
  onRemove: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(reply.content);

  const save = () => {
    const text = draft.trim();
    if (!text) return;
    onUpdate(reply.id, text);
    setEditing(false);
  };

  return (
    <li className="rounded-xl border border-[#fb7299]/25 bg-[#fff4f8]/70 px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span
          title="这条回复只保存在本地并显示在这里，不会同步到 B 站"
          className="flex items-center gap-0.5 rounded-full bg-[#fb7299]/12 px-1.5 py-px text-[10px] font-bold text-[#fb7299]"
        >
          <Icon icon="lucide:message-circle" width="11" height="11" aria-hidden="true" />
          本地回复
        </span>
        <span className="ml-auto text-xs text-[#9b8a91]">
          {formatRelative(reply.createdAt)}
        </span>
      </div>

      {editing ? (
        <div className="mt-1.5 flex flex-col gap-1.5">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={2}
            className={textareaClass}
          />
          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={save}
              disabled={!draft.trim()}
              className="cursor-pointer rounded-full bg-[#f5b3c9] px-3 py-1 font-bold text-[#5e4c53] shadow-none transition-colors hover:bg-[#f8c3d5] disabled:cursor-not-allowed disabled:opacity-50"
            >
              保存
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(reply.content);
                setEditing(false);
              }}
              className="cursor-pointer rounded-full bg-transparent px-3 py-1 font-semibold text-[#9b8a91] shadow-none transition-colors hover:text-[#66535a]"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="m-0 mt-1 text-sm leading-relaxed break-words whitespace-pre-wrap text-[#66535a]">
            {reply.content}
          </p>
          <div className="mt-1 flex items-center gap-3 text-xs text-[#9b8a91]">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className={actionButtonClass()}
            >
              <Icon icon="lucide:pencil" width="13" height="13" aria-hidden="true" />
              修改
            </button>
            <button
              type="button"
              onClick={() => onRemove(reply.id)}
              className={actionButtonClass()}
            >
              <Icon icon="lucide:trash" width="13" height="13" aria-hidden="true" />
              删除
            </button>
          </div>
        </>
      )}
    </li>
  );
}
