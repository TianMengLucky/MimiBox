import type { DragEvent } from "react";
import { Icon } from "@iconify/react";
import { setDragPayload } from "./dnd";
import type { TierItem } from "./types";

/** × 图标数据直传（不查 iconify 存储，确保任何环境下都渲染） */
const X_ICON = {
  width: 24,
  height: 24,
  body: '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M18 6L6 18M6 6l12 12"/>',
};

/** 可拖拽的图片条目：梯队与待排池共用；右上角小叉按 removeLabel 执行“移回待排”或“删除” */
export function ItemChip({
  item,
  from,
  removeLabel,
  onRemove,
  disabled,
}: {
  item: TierItem;
  /** 所属位置："pool" 或梯队 id，拖拽时随载荷带出 */
  from: string;
  removeLabel: string;
  onRemove: () => void;
  disabled?: boolean;
}) {
  return (
    <div
      draggable={!disabled}
      onDragStart={(event: DragEvent) => setDragPayload(event, { from, id: item.id })}
      className="group relative"
    >
      <img
        src={item.image}
        alt={item.name || "未命名图片"}
        title={item.name || undefined}
        draggable={false}
        className="block h-[clamp(2.75rem,7vh,3.5rem)] w-[clamp(2.75rem,7vh,3.5rem)] rounded-lg border border-white/70 object-cover shadow-sm"
      />
      <button
        type="button"
        disabled={disabled}
        aria-label={removeLabel}
        title={removeLabel}
        onClick={onRemove}
        className="absolute -top-2 -right-2 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border-0 bg-rose-500 p-0 text-white shadow-md ring-1 ring-white/60 hover:border-transparent hover:bg-rose-600 disabled:cursor-default"
      >
        <Icon icon={X_ICON} width="16" height="16" aria-hidden="true" />
      </button>
    </div>
  );
}
