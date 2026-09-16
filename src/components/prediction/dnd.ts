import type { DragEvent } from "react";
import { DRAG_MIME } from "./types";

/** 拖拽载荷：被拖拽的选项 id（放置 = 复制，来源位置保留） */
export interface DragPayload {
  entryId: string;
}

/** 拖拽开始时写入载荷 */
export function setDragPayload(event: DragEvent, payload: DragPayload): void {
  event.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
  event.dataTransfer.effectAllowed = "copy";
}

/** 放置时读出载荷；非应用内拖拽返回 null */
export function readDragPayload(event: DragEvent): DragPayload | null {
  const raw = event.dataTransfer.getData(DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DragPayload>;
    if (typeof parsed.entryId === "string") {
      return { entryId: parsed.entryId };
    }
    return null;
  } catch {
    return null;
  }
}

/** dragover 时判断是否为应用内的选项拖拽（OS 文件拖拽不带该标记） */
export function isEntryDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes(DRAG_MIME);
}

/** dragover 时判断是否携带着系统文件（如从资源管理器拖入的图片） */
export function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

/** 取出拖入事件里的第一个图片文件；没有则返回 null */
export function firstImageFile(event: DragEvent): File | null {
  const file = event.dataTransfer.files[0];
  return file && file.type.startsWith("image/") ? file : null;
}
