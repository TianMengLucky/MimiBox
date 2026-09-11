import { useRef, useState } from "react";
import { Icon } from "@iconify/react";

/**
 * 文件选择区：点击打开系统文件选择窗口，或把文件拖进来。
 * 组件只负责收集文件并回调，不过滤类型（accept 传给文件窗口，拖入文件的过滤由调用方处理）。
 */
export function FileDropZone({
  accept,
  multiple = false,
  disabled = false,
  compact = false,
  icon = "lucide:file-up",
  title,
  hint,
  onFiles,
}: {
  /** 传给文件选择窗口的 accept 过滤，如 "image/*" */
  accept?: string;
  /** 是否允许多选 */
  multiple?: boolean;
  disabled?: boolean;
  /** 紧凑模式：更小的内边距与图标，适合空间紧张的面板 */
  compact?: boolean;
  /** 图标（Iconify 名称） */
  icon?: string;
  /** 主提示文案 */
  title: string;
  /** 次提示文案 */
  hint?: string;
  /** 拿到用户选择 / 拖入的文件 */
  onFiles: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (disabled) return;
          onFiles(Array.from(event.dataTransfer.files));
        }}
        className={`flex w-full flex-col items-center justify-center text-center transition-colors ${
          compact ? "gap-0.5 rounded-xl border-2 border-dashed px-3 py-2" : "gap-1 rounded-2xl border-2 border-dashed px-4 py-5"
        } ${
          disabled
            ? "cursor-default border-[#e7d5dd] bg-white/30 opacity-60"
            : dragging
              ? "cursor-pointer border-[#d26d9a] bg-[#fff1f7]"
              : "cursor-pointer border-[#e7d5dd] bg-white/45 hover:border-[#d26d9a]"
        }`}
      >
        <Icon icon={icon} width={compact ? 16 : 22} height={compact ? 16 : 22} className="text-[#d26d9a]" aria-hidden="true" />
        <span className={compact ? "text-[13px] font-bold text-[#66535a]" : "text-sm font-bold text-[#66535a]"}>{title}</span>
        {hint ? <span className="text-xs text-[#9b8a91]">{hint}</span> : null}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(event) => {
          onFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
    </>
  );
}
