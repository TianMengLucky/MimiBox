import type { DragEvent } from "react";
import { DRAG_MIME } from "./types";

/** 拖拽载荷：条目 id + 来源位置（"pool" 或梯队 id） */
export interface DragSource {
  from: string;
  id: string;
}

/** 拖拽开始时写入载荷 */
export function setDragPayload(event: DragEvent, source: DragSource): void {
  event.dataTransfer.setData(DRAG_MIME, JSON.stringify(source));
  event.dataTransfer.effectAllowed = "move";
}

/** 放置时读出载荷；非应用内拖拽（如 OS 文件）返回 null */
export function readDragPayload(event: DragEvent): DragSource | null {
  const raw = event.dataTransfer.getData(DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DragSource>;
    if (typeof parsed.from === "string" && typeof parsed.id === "string") {
      return { from: parsed.from, id: parsed.id };
    }
    return null;
  } catch {
    return null;
  }
}

/** dragover 时判断是否为应用内的条目拖拽（OS 文件拖拽不带该标记） */
export function isItemDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes(DRAG_MIME);
}
