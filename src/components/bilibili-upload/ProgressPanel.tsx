import { Icon } from "@iconify/react";
import { ProgressBar } from "@heroui/react";
import type { UploadProgress } from "./types";
import { formatBytes } from "./format";

/** 进度条面板：阶段文案 + 百分比 + 已传/总大小 + 取消按钮 */
export function ProgressPanel({
  progress,
  onCancel,
}: {
  progress: UploadProgress;
  onCancel: () => void;
}) {
  const phaseText =
    progress.phase === "preupload"
      ? "正在申请上传线路…"
      : progress.phase === "merging"
        ? "上传完成，正在合片…"
        : "正在上传视频";
  const percent = progress.total > 0 ? Math.min(100, Math.round((progress.uploaded / progress.total) * 100)) : 0;

  return (
    <div
      role="status"
      aria-label="投稿进度"
      className="flex flex-col gap-2 rounded-2xl border border-[#f3d9e6] bg-white/70 px-4 py-3"
    >
      <div className="flex items-center gap-2">
        <Icon
          icon={progress.phase === "merging" ? "lucide:package-check" : "lucide:upload"}
          width="16"
          height="16"
          aria-hidden="true"
          className="shrink-0 text-[#d26d9a]"
        />
        <span className="text-sm font-bold text-[#66535a]">{phaseText}</span>
        <span className="ml-auto text-xs font-semibold text-[#9b8a91]" aria-hidden="true">
          {percent}%
        </span>
        <button
          type="button"
          className="flex cursor-pointer items-center gap-1 rounded-full border border-white/70 bg-white px-3 py-1 text-xs font-bold text-[#c25582] shadow-[0_2px_8px_rgb(133_77_96/14%)] transition-colors hover:bg-[#fff1f7]"
          onClick={onCancel}
        >
          <Icon icon="lucide:x" width="12" height="12" aria-hidden="true" />
          取消
        </button>
      </div>
      <ProgressBar
        aria-label="上传进度"
        size="sm"
        color="accent"
        value={percent}
        maxValue={100}
        valueLabel={progress.total > 0 ? `${formatBytes(progress.uploaded)} / ${formatBytes(progress.total)}` : undefined}
      />
      <span className="sr-only" aria-live="polite">
        {phaseText}，已完成 {percent}%
      </span>
    </div>
  );
}
