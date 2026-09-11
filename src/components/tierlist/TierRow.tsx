import { useState } from "react";
import { isItemDrag, readDragPayload } from "./dnd";
import type { DragSource } from "./dnd";
import { ItemChip } from "./ItemChip";
import type { Tier } from "./types";

/** 单个梯队行：固定名称与底色，仅接收条目拖入 */
export function TierRow({
  tier,
  disabled,
  onDropItem,
  onReturnToPool,
}: {
  tier: Tier;
  disabled?: boolean;
  onDropItem: (source: DragSource) => void;
  onReturnToPool: (source: DragSource) => void;
}) {
  const [dropping, setDropping] = useState(false);

  return (
    <li
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
        // 拖回原梯队视为无操作
        if (source.from !== tier.id) onDropItem(source);
      }}
      className={`flex flex-1 items-stretch gap-2 rounded-2xl px-2 py-1.5 transition-colors ${
        dropping ? "bg-[#fff1f7]" : "bg-white/55"
      }`}
    >
      <div
        className="flex w-[clamp(3.5rem,10vw,5rem)] shrink-0 items-center justify-center rounded-xl border border-black/5 px-1.5"
        style={{ backgroundColor: tier.color }}
      >
        <span className="text-center text-sm font-bold break-all text-[#262626]">
          {tier.name}
        </span>
      </div>

      <div className="flex min-h-[clamp(2.75rem,7vh,3.5rem)] min-w-0 flex-1 flex-wrap content-start items-start gap-2 py-0.5">
        {tier.items.length === 0 ? (
          <span className="self-center px-2 text-xs text-[#b7a4ac]">把图片拖进这个梯队</span>
        ) : (
          tier.items.map((item) => (
            <ItemChip
              key={item.id}
              item={item}
              from={tier.id}
              disabled={disabled}
              removeLabel={`把“${item.name || "未命名图片"}”移回待排`}
              onRemove={() => onReturnToPool({ from: tier.id, id: item.id })}
            />
          ))
        )}
      </div>
    </li>
  );
}
