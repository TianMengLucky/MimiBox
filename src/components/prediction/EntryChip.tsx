import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import { Icon } from "@iconify/react";
import { firstImageFile, hasFiles, isEntryDrag, setDragPayload } from "./dnd";
import type { PredictionEntry } from "./types";

/** 选项库里的可拖拽选项：图片 + 可点击改名的名称，可把图片文件直接拖到选项上换图 */
export function EntryChip({
  entry,
  disabled,
  onRename,
  onRemove,
  onImageFile,
}: {
  entry: PredictionEntry;
  disabled?: boolean;
  onRename: (name: string) => void;
  onRemove: () => void;
  onImageFile: (file: File) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [dropping, setDropping] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(entry.name);

  useEffect(() => {
    if (editing) {
      setDraft(entry.name);
      // 等输入框挂载后再聚焦
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [editing, entry.name]);

  const commit = () => {
    setEditing(false);
    const name = draft.trim();
    if (name !== entry.name) onRename(name);
  };

  const handleDrop = (event: DragEvent) => {
    setDropping(false);
    // 应用内的选项拖拽不在此处理（池子不是放置目标）
    if (disabled || isEntryDrag(event)) return;
    const file = firstImageFile(event);
    if (!file) return;
    event.preventDefault();
    onImageFile(file);
  };

  return (
    <div
      draggable={!disabled}
      onDragStart={(event: DragEvent) => setDragPayload(event, { entryId: entry.id })}
      className="group relative flex w-[72px] flex-col items-center gap-1 rounded-xl border bg-white/60 p-1.5 transition-colors"
      style={{
        borderColor: dropping ? "#d26d9a" : "rgba(231, 213, 221, 0.9)",
        backgroundColor: dropping ? "#fff1f7" : undefined,
      }}
      onDragOver={(event) => {
        if (disabled || isEntryDrag(event) || !hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDropping(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDropping(false);
        }
      }}
      onDrop={handleDrop}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => fileInputRef.current?.click()}
        aria-label={`为“${entry.name || "未命名选项"}”上传图片`}
        title={entry.image ? "点击更换 / 直接拖入图片" : "点击上传 / 直接拖入图片"}
        className="relative block h-10 w-10 cursor-pointer overflow-hidden rounded-lg border border-white/70 bg-white/60 p-0 shadow-none hover:border-[#d26d9a] disabled:cursor-default"
      >
        {entry.image ? (
          <img
            src={entry.image}
            alt={entry.name || "未命名选项"}
            draggable={false}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[#c9b6bf]">
            <Icon icon="lucide:image" width="18" height="18" aria-hidden="true" />
          </span>
        )}
      </button>
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
            if (event.key === "Escape") setEditing(false);
          }}
          aria-label="选项名称"
          className="w-full rounded-md border border-[#d26d9a]/70 bg-white px-1 py-0 text-center text-[11px] leading-5 font-semibold text-[#66535a] outline-none"
        />
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setEditing(true)}
          title={entry.name ? `点击修改名称：${entry.name}` : "点击填写名称"}
          className="w-full cursor-pointer truncate rounded-md border-0 bg-transparent px-0.5 py-0 text-center text-[11px] leading-5 font-semibold text-[#66535a] hover:bg-[#fff1f7] disabled:cursor-default"
        >
          {entry.name || "未命名"}
        </button>
      )}
      <button
        type="button"
        disabled={disabled}
        aria-label={`删除选项“${entry.name || "未命名"}”，会同时从所有节点移除`}
        title="删除该选项（同时从所有节点移除）"
        onClick={onRemove}
        className="absolute -top-2 -right-2 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border-0 bg-rose-500 p-0 text-white opacity-0 shadow-md transition-opacity ring-1 ring-white/60 group-hover:opacity-100 focus-visible:opacity-100 hover:border-transparent hover:bg-rose-600 disabled:cursor-default"
      >
        <Icon icon="lucide:x" width="12" height="12" aria-hidden="true" />
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onImageFile(file);
          event.target.value = "";
        }}
      />
    </div>
  );
}
