import { useRef, useState } from "react";
import { Button } from "@heroui/react";
import { Icon } from "@iconify/react";
import {
  firstImageFile,
  hasFiles,
  isEntryDrag,
  readDragPayload,
} from "./dnd";
import type { PredictionEntry, PredictionNode } from "./types";

/** 节点内一次拖拽/点击上传待处理的席位下标 */
type PendingSlot = { nodeRef: string; slotIndex: number };

/** 比赛节点：标题 + 固定两个席位（主客两选项）；席位可拖入选项、改比分、换图、清空 */
export function MatchNode({
  node,
  entryById,
  disabled,
  onTitleChange,
  onPlaceEntry,
  onClearSlot,
  onScoreChange,
  onSlotImageFile,
  onDelete,
}: {
  node: PredictionNode;
  /** 选项 id → 选项（席位展示用） */
  entryById: Map<string, PredictionEntry>;
  disabled?: boolean;
  onTitleChange: (title: string) => void;
  /** entryId 放进该节点；slotIndex 为 null 时自动放入第一个空位 */
  onPlaceEntry: (entryId: string, slotIndex: number | null) => void;
  onClearSlot: (slotIndex: number) => void;
  onScoreChange: (slotIndex: number, score: string) => void;
  onSlotImageFile: (slotIndex: number, file: File) => void;
  onDelete: () => void;
}) {
  const [nodeDropping, setNodeDropping] = useState(false);
  const [rowDropping, setRowDropping] = useState<number | null>(null);
  const [thumbDropping, setThumbDropping] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingSlotRef = useRef<PendingSlot | null>(null);

  const openFile = (slotIndex: number) => {
    pendingSlotRef.current = { nodeRef: node.id, slotIndex };
    fileInputRef.current?.click();
  };

  const handleFile = async (file: File | undefined) => {
    const pending = pendingSlotRef.current;
    if (!file || !pending || pending.nodeRef !== node.id) return;
    onSlotImageFile(pending.slotIndex, file);
  };

  return (
    <div
      onDragOver={(event) => {
        if (disabled || !isEntryDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setNodeDropping(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setNodeDropping(false);
        }
      }}
      onDrop={(event) => {
        setNodeDropping(false);
        if (disabled) return;
        const payload = readDragPayload(event);
        if (!payload) return;
        event.preventDefault();
        onPlaceEntry(payload.entryId, null);
      }}
      className={`flex flex-col gap-1.5 rounded-xl border p-2 transition-colors ${
        nodeDropping
          ? "border-[#d26d9a] bg-[#fff1f7]"
          : "border-[#e7d5dd] bg-white/70"
      }`}
    >
      <div className="flex items-center gap-1">
        <input
          value={node.title}
          disabled={disabled}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder="节点标题（如 8月29日 18:30）"
          aria-label="节点标题"
          className="nodrag min-w-0 flex-1 rounded-md border-0 bg-transparent px-1 py-0 text-xs leading-5 font-bold text-[#66535a] outline-none placeholder:font-normal placeholder:text-[#c9b6bf] focus:bg-[#fff1f7]"
        />
        <Button
          variant="tertiary"
          size="sm"
          isIconOnly
          className="h-6 w-6 min-w-6 rounded-lg text-[#b7a4ac]"
          isDisabled={disabled}
          aria-label={`删除节点“${node.title || "未命名"}”`}
          onPress={onDelete}
        >
          <Icon icon="lucide:trash-2" width="13" height="13" aria-hidden="true" />
        </Button>
      </div>

      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {node.slots.map((slot, index) => {
          const entry = slot.entryId ? entryById.get(slot.entryId) : undefined;
          if (!entry) {
            return (
              <li
                key={index}
                onDragOver={(event) => {
                  if (disabled || !isEntryDrag(event)) return;
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = "move";
                  setRowDropping(index);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setRowDropping(null);
                  }
                }}
                onDrop={(event) => {
                  setRowDropping(null);
                  if (disabled) return;
                  const payload = readDragPayload(event);
                  if (!payload) return;
                  event.preventDefault();
                  event.stopPropagation();
                  onPlaceEntry(payload.entryId, index);
                }}
                className={`flex h-9 items-center justify-center rounded-lg border border-dashed text-xs transition-colors ${
                  rowDropping === index
                    ? "border-[#d26d9a] bg-[#fff1f7] text-[#d26d9a]"
                    : "border-[#e7d5dd] text-[#b7a4ac]"
                }`}
              >
                拖入选项
              </li>
            );
          }
          return (
            <li
              key={index}
              onDragOver={(event) => {
                if (disabled || !isEntryDrag(event)) return;
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = "move";
                setRowDropping(index);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setRowDropping(null);
                }
              }}
              onDrop={(event) => {
                setRowDropping(null);
                if (disabled) return;
                const payload = readDragPayload(event);
                if (!payload) return;
                event.preventDefault();
                event.stopPropagation();
                // 拖到已填席位 = 替换该席位（比分一并清零）
                onPlaceEntry(payload.entryId, index);
              }}
              className={`flex h-9 items-center gap-1.5 rounded-lg px-1.5 transition-colors ${
                rowDropping === index ? "bg-[#fff1f7]" : "bg-white"
              }`}
            >
              <button
                type="button"
                disabled={disabled}
                onClick={() => openFile(index)}
                onDragOver={(event) => {
                  if (disabled || isEntryDrag(event) || !hasFiles(event)) return;
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = "copy";
                  setThumbDropping(index);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setThumbDropping(null);
                  }
                }}
                onDrop={(event) => {
                  setThumbDropping(null);
                  if (disabled || isEntryDrag(event)) return;
                  const file = firstImageFile(event);
                  if (!file) return;
                  event.preventDefault();
                  event.stopPropagation();
                  onSlotImageFile(index, file);
                }}
                aria-label={`为“${entry.name || "未命名选项"}”上传图片`}
                title="点击上传或拖入图片"
                className={`flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-md border bg-cover bg-center p-0 transition-colors disabled:cursor-default ${
                  thumbDropping === index
                    ? "border-[#d26d9a]"
                    : "border-[#e7d5dd] hover:border-[#d26d9a]"
                }`}
                style={entry.image ? { backgroundImage: `url(${entry.image})` } : undefined}
              >
                {!entry.image && (
                  <Icon
                    icon="lucide:image-plus"
                    width="13"
                    height="13"
                    className="text-[#b7a4ac]"
                    aria-hidden="true"
                  />
                )}
              </button>
              <span
                className="min-w-0 flex-1 truncate text-xs font-semibold text-[#66535a]"
                title={`${entry.name || "未命名选项"}（在左侧选项库中改名）`}
              >
                {entry.name || "未命名选项"}
              </span>
              <input
                value={slot.score}
                disabled={disabled}
                maxLength={6}
                onChange={(event) => onScoreChange(index, event.target.value)}
                aria-label={`“${entry.name || "未命名选项"}”的比分`}
                placeholder="比分"
                className="nodrag w-11 shrink-0 rounded-md border border-[#e7d5dd] bg-white/70 px-1 py-0 text-center text-xs leading-6 text-[#66535a] outline-none placeholder:text-[#d8c7cf] focus:border-[#d26d9a]"
              />
              <button
                type="button"
                disabled={disabled}
                aria-label={`把“${entry.name || "未命名选项"}”移出该席位`}
                title="移出该席位（选项仍保留在选项库）"
                onClick={() => onClearSlot(index)}
                className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-[#c9b6bf] shadow-none hover:bg-[#fff1f7] hover:text-rose-500 disabled:cursor-default"
              >
                <Icon icon="lucide:x" width="12" height="12" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          void handleFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </div>
  );
}
