"use no memo";

import { useState } from "react";
import { Icon } from "@iconify/react";
import { Spinner } from "@heroui/react";
import { FileDropZone } from "@components/FileDropZone";
import { tauriInvoke } from "../../lib/tauriInvoke";
import { errorMessage } from "../../lib/errors";

/** 封面图片选择过滤 */
const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";

/** 压缩封面到 2MB 内（data URI，最长边 1600px，JPEG 重编码） */
async function compressCover(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("读取封面文件失败"));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("封面图片解析失败"));
    img.src = dataUrl;
  });
  const maxEdge = 1600;
  const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.9);
}

/**
 * 封面选择与上传：选图后本地压缩，再经 Rust 上传到 B 站换取封面 URL。
 * 上传成功即回调 onUploaded；失败时展示错误并保留重试机会。
 */
export function CoverPicker({
  disabled,
  coverUrl,
  onUploaded,
  onCleared,
}: {
  disabled?: boolean;
  coverUrl: string;
  onUploaded: (url: string) => void;
  onCleared: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleFiles = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setError("");
    setBusy(true);
    try {
      const dataUri = await compressCover(file);
      const { url } = await tauriInvoke<{ url: string }>("bilibili_upload_cover", { dataUri });
      onUploaded(url);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      {coverUrl ? (
        <div className="flex items-center gap-3">
          <img
            src={coverUrl}
            alt="封面预览"
            className="h-20 w-36 rounded-xl border border-white/70 object-cover shadow-[0_2px_8px_rgb(133_77_96/14%)]"
          />
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              disabled={disabled || busy}
              className="flex cursor-pointer items-center gap-1 rounded-full border border-white/70 bg-white px-3 py-1.5 text-xs font-bold text-[#66535a] shadow-[0_2px_8px_rgb(133_77_96/14%)] transition-colors hover:bg-[#fff1f7] disabled:cursor-default disabled:opacity-50"
              onClick={onCleared}
            >
              <Icon icon="lucide:image-off" width="13" height="13" aria-hidden="true" />
              移除封面
            </button>
            <p className="m-0 text-xs text-[#9b8a91]">不设置封面时 B 站会自动截取视频画面</p>
          </div>
        </div>
      ) : (
        <div className="relative">
          <FileDropZone
            accept={IMAGE_ACCEPT}
            icon="lucide:image-plus"
            title="选择封面图（可选）"
            hint="jpg / png / webp，自动压缩后上传"
            compact={busy}
            disabled={disabled || busy}
            onFiles={(files) => void handleFiles(files)}
          />
          {busy && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-2xl bg-white/70 text-xs font-semibold text-[#66535a]">
              <Spinner size="sm" color="accent" />
              正在上传封面…
            </div>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="m-0 text-xs text-[#d26d9a]">
          {error}
        </p>
      )}
    </div>
  );
}
