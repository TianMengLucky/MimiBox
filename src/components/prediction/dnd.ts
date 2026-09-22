import type { DragEvent } from "react";
import { hasDragType, readDragJson, setDragJson } from "../../lib/dnd";
import { DRAG_MIME } from "./types";

/** 预测功能选项拖拽的载荷与读写（共享 JSON/文件拖拽工具在 src/lib/dnd.ts） */

/** 拖拽载荷：被拖拽的选项 id（放置 = 复制，来源位置保留） */
export interface DragPayload {
  entryId: string;
}

/** 拖拽开始时写入载荷 */
export function setDragPayload(event: DragEvent, payload: DragPayload): void {
  setDragJson(event, DRAG_MIME, payload, "copy");
}

/** 放置时读出载荷；非应用内拖拽返回 null */
export function readDragPayload(event: DragEvent): DragPayload | null {
  return readDragJson<DragPayload>(event, DRAG_MIME, (value) =>
    typeof value.entryId === "string" ? { entryId: value.entryId } : null,
  );
}

/** dragover 时判断是否为应用内的选项拖拽（OS 文件拖拽不带该标记） */
export function isEntryDrag(event: DragEvent): boolean {
  return hasDragType(event, DRAG_MIME);
}

export { hasFiles, firstImageFile } from "../../lib/dnd";
