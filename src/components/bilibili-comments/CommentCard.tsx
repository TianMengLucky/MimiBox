"use no memo";

import { useState } from "react";
import { Icon } from "@iconify/react";
import { formatCount, formatRelative } from "./format";
import type { CommentItem } from "./types";

/** 硬币等级徽章配色：0-1 灰 / 2-3 绿 / 4-5 琥珀 / 6+ B 站粉 */
function levelBadgeClass(level: number): string {
  if (level >= 6) return "bg-[#fb7299] text-white";
  if (level >= 4) return "bg-[#f5b544] text-[#6b4a12]";
  if (level >= 2) return "bg-[#95de64] text-[#2f6b3a]";
  return "bg-[#e3d3da] text-[#9b8a91]";
}

/** 单条评论：圆头像 + 昵称 + 等级徽章 + 时间 + 内容 + 点赞 */
export default function CommentCard({ comment }: { comment: CommentItem }) {
  const [avatarFailed, setAvatarFailed] = useState(false);

  return (
    <li className="flex gap-3 rounded-2xl border border-white/55 bg-white/65 p-3.5 shadow-[0_4px_18px_rgb(133_77_96/10%)]">
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
          <span className="ml-auto text-xs text-[#9b8a91]">
            {formatRelative(comment.ctime)}
          </span>
        </div>
        <p className="m-0 mt-1.5 text-sm leading-relaxed break-words whitespace-pre-wrap text-[#66535a]">
          {comment.content}
        </p>
        <div className="mt-1.5 flex items-center gap-1 text-xs text-[#9b8a91]">
          <Icon icon="lucide:thumbs-up" width="13" height="13" aria-hidden="true" />
          {comment.likes > 0 ? formatCount(comment.likes) : "赞"}
        </div>
      </div>
    </li>
  );
}
