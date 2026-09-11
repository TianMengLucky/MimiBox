import { useState } from "react";
import { FileDropZone } from "@components/FileDropZone";
import { isItemDrag, readDragPayload } from "./dnd";
import type { DragSource } from "./dnd";
import { ItemChip } from "./ItemChip";
import type { TierItem } from "./types";

/** 待排图片池：上方大号批量导入区，下方固定高度的池子接收从梯队拖回的条目 */
export function PoolPanel({
  pool,
  disabled,
  canAdd,
  onAddFiles,
  onMoveToPool,
  onRemove,
}: {
  pool: TierItem[];
  disabled?: boolean;
  /** 图片总数未达上限时才允许继续导入 */
  canAdd: boolean;
  onAddFiles: (files: File[]) => void;
  onMoveToPool: (source: DragSource) => void;
  onRemove: (id: string) => void;
}) {
  const [dropping, setDropping] = useState(false);

  return (
    <section aria-label="待排图片" className="flex min-h-fit flex-col gap-1.5">
      <FileDropZone
        accept="image/*"
        multiple
        disabled={disabled || !canAdd}
        icon="lucide:image-plus"
        title={canAdd ? "拖入图片批量添加待排" : "已达图片数量上限"}
        hint="或点击选择文件，可多选；文件名将作为图片名"
        onFiles={onAddFiles}
      />
      <div
        onDragOver={(event) => {
          if (disabled || !isItemDrag(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDropping(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDropping(false);
          }
        }}
        onDrop={(event) => {
          setDropping(false);
          if (disabled) return;
          const source = readDragPayload(event);
          if (!source) return;
          event.preventDefault();
          if (source.from !== "pool") onMoveToPool(source);
        }}
        className={`flex h-[clamp(4.5rem,12vh,7rem)] flex-wrap content-start items-start gap-1.5 overflow-y-auto rounded-2xl border-2 border-dashed p-2 transition-colors ${
          dropping ? "border-[#d26d9a] bg-[#fff1f7]" : "border-[#e7d5dd] bg-white/35"
        }`}
      >
        {pool.length === 0 ? (
          <span className="self-center px-2 text-xs text-[#b7a4ac]">
            这里会放置还没有排名的图片；拖错了也可以从梯队拖回来。
          </span>
        ) : (
          pool.map((item) => (
            <ItemChip
              key={item.id}
              item={item}
              from="pool"
              disabled={disabled}
              removeLabel={`删除“${item.name || "未命名图片"}”`}
              onRemove={() => onRemove(item.id)}
            />
          ))
        )}
      </div>
    </section>
  );
}
