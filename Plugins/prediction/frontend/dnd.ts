import type { DragEvent } from "react";
import { hasDragType, readDragJson, setDragJson } from "@lib/dnd";
import { DRAG_MIME } from "./types";

/** 预测功能选项拖拽的载荷与读写（共享 JSON 拖拽工具经 @lib/dnd 由宿主提供；
    宿主共享表未含文件拖拽判断的 hasFiles/firstImageFile，这两个纯函数在本插件内实现） */

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

/** dragover 时判断是否携带着系统文件（如从资源管理器拖入的图片） */
export function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

/** 取出拖入事件里的第一个图片文件；没有则返回 null */
export function firstImageFile(event: DragEvent): File | null {
  const file = event.dataTransfer.files[0];
  return file && file.type.startsWith("image/") ? file : null;
}
