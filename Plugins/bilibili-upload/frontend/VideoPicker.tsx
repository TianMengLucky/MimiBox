"use no memo";

import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { formatBytes } from "@lib/format";
import { errorMessage } from "@lib/errors";
import type { VideoFileInfo } from "./types";
import { FileDropZone } from "@components/FileDropZone";
import type { BilibiliUploadApi } from "./api";

/** 视频文件选择过滤（与后端 VIDEO_EXTS 一致） */
const VIDEO_ACCEPT = ".mp4,.flv,.avi,.wmv,.mov,.webm,.mkv,.m4v,.ts,.3gp,.mpeg,.mpg";

/**
 * 视频选择卡片：文件对话框/拖拽选文件后调用后端探测大小并回显。
 * 选择新文件时通过 onPick 通知父级拿到绝对路径（File 对象自带 path）。
 */
export function VideoPicker({
  api,
  disabled,
  info,
  onPicked,
  onCleared,
}: {
  api: BilibiliUploadApi;
  disabled?: boolean;
  info: VideoFileInfo | null;
  onPicked: (path: string, info: VideoFileInfo) => void;
  onCleared: () => void;
}) {
  const [error, setError] = useState("");

  useEffect(() => {
    if (!info) setError("");
  }, [info]);

  const handleFiles = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    const path = (file as File & { path?: string }).path;
    if (!path) {
      setError("未能获取文件路径，请通过点击选择文件");
      return;
    }
    setError("");
    try {
      const probed = await api.probeVideo(path);
      onPicked(path, probed);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (info) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-[#e7d5dd] bg-white/60 px-4 py-3">
        <Icon icon="lucide:film" width="26" height="26" aria-hidden="true" className="shrink-0 text-[#d26d9a]" />
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-sm font-bold text-[#66535a]">{info.name}</p>
          <p className="m-0 mt-0.5 text-xs text-[#9b8a91]">{formatBytes(info.size)}</p>
        </div>
        <button
          type="button"
          disabled={disabled}
          aria-label="重新选择视频"
          className="flex cursor-pointer items-center gap-1 rounded-full border border-white/70 bg-white px-3 py-1.5 text-xs font-bold text-[#66535a] shadow-[0_2px_8px_rgb(133_77_96/14%)] transition-colors hover:bg-[#fff1f7] disabled:cursor-default disabled:opacity-50"
          onClick={onCleared}
        >
          <Icon icon="lucide:refresh-cw" width="13" height="13" aria-hidden="true" />
          换一个
        </button>
      </div>
    );
  }

  return (
    <div>
      <FileDropZone
        accept={VIDEO_ACCEPT}
        icon="lucide:film"
        title="选择要投稿的视频"
        hint="支持 mp4 / mkv / flv 等常见格式，点击选择或拖入"
        disabled={disabled}
        onFiles={(files) => void handleFiles(files)}
      />
      {error && (
        <p role="alert" className="m-0 mt-1 text-xs text-[#d26d9a]">
          {error}
        </p>
      )}
    </div>
  );
}
