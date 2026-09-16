"use no memo";

import { Icon } from "@iconify/react";
import { formatCount, formatRelative } from "./format";
import type { VideoSummary } from "./types";

/** 视频选择卡片：封面 + 时长角标 + 标题 + 播放/评论数 + 发布时间 */
export default function VideoCard({
  video,
  onSelect,
}: {
  video: VideoSummary;
  onSelect: (video: VideoSummary) => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-label={`查看「${video.title}」的评论区`}
        onClick={() => onSelect(video)}
        className="group flex h-full w-full cursor-pointer flex-col gap-2 rounded-2xl border border-white/55 bg-white/65 p-2.5 text-left shadow-[0_4px_18px_rgb(133_77_96/12%)] transition hover:-translate-y-0.5 hover:border-[#f2bfd8] hover:shadow-[0_8px_24px_rgb(133_77_96/18%)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fb7299] motion-reduce:transition-none"
      >
        <span className="relative block w-full overflow-hidden rounded-xl bg-[#f6e3e1] aspect-video">
          {video.cover ? (
            <img
              src={video.cover}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover transition group-hover:scale-[1.03] motion-reduce:transition-none"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center">
              <Icon
                icon="lucide:image-off"
                width="26"
                height="26"
                aria-hidden="true"
                className="text-[#d8c7cf]"
              />
            </span>
          )}
          {video.duration && (
            <span className="absolute right-1.5 bottom-1.5 rounded-md bg-black/55 px-1 py-px font-mono text-[11px] text-white">
              {video.duration}
            </span>
          )}
        </span>
        <span className="line-clamp-2 text-sm leading-snug font-semibold text-[#66535a]">
          {video.title}
        </span>
        <span className="mt-auto flex items-center gap-3 pt-0.5 text-xs text-[#9b8a91]">
          <span className="flex items-center gap-1">
            <Icon icon="lucide:play" width="13" height="13" aria-hidden="true" />
            {formatCount(video.play)}
          </span>
          <span className="flex items-center gap-1">
            <Icon icon="lucide:message-circle" width="13" height="13" aria-hidden="true" />
            {formatCount(video.comment)}
          </span>
          <span className="ml-auto">{formatRelative(video.created)}</span>
        </span>
      </button>
    </li>
  );
}
