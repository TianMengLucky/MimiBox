import type { DragEvent } from "react";
import { hasDragType, readDragJson, setDragJson } from "@lib/dnd";
import { DRAG_MIME } from "./types";

/** 梯队功能条目拖拽的载荷与读写（共享 JSON/文件拖拽工具在宿主 @lib/dnd） */

/** 拖拽载荷：条目 id + 来源位置（"pool" 或梯队 id） */
export interface DragSource {
  from: string;
  id: string;
}

/** 拖拽开始时写入载荷 */
export function setDragPayload(event: DragEvent, source: DragSource): void {
  setDragJson(event, DRAG_MIME, source, "move");
}

/** 放置时读出载荷；非应用内拖拽（如 OS 文件）返回 null */
export function readDragPayload(event: DragEvent): DragSource | null {
  return readDragJson<DragSource>(event, DRAG_MIME, (value) =>
    typeof value.from === "string" && typeof value.id === "string"
      ? { from: value.from, id: value.id }
      : null,
  );
}

/** dragover 时判断是否为应用内的条目拖拽（OS 文件拖拽不带该标记） */
export function isItemDrag(event: DragEvent): boolean {
  return hasDragType(event, DRAG_MIME);
}
