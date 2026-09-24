import type { DragEvent } from "react";

/** HTML5 拖拽的共享工具：各功能用自己的 DRAG_MIME 区分载荷（prediction/tierlist 等） */

/** dragover 时判断 dataTransfer 是否携带某 MIME 标记（OS 文件拖拽不带应用内 MIME） */
export function hasDragType(event: DragEvent, mime: string): boolean {
  return Array.from(event.dataTransfer.types).includes(mime);
}

/** 拖拽开始时写入 JSON 载荷并声明允许的拖放效果（copy=复制保留来源，move=移动） */
export function setDragJson(
  event: DragEvent,
  mime: string,
  payload: unknown,
  effectAllowed: DataTransfer["effectAllowed"],
): void {
  event.dataTransfer.setData(mime, JSON.stringify(payload));
  event.dataTransfer.effectAllowed = effectAllowed;
}

/** 放置时读出 JSON 载荷并校验；非应用内拖拽（无标记）或格式不符返回 null */
export function readDragJson<T>(
  event: DragEvent,
  mime: string,
  validate: (value: Partial<T>) => T | null,
): T | null {
  const raw = event.dataTransfer.getData(mime);
  if (!raw) return null;
  try {
    return validate(JSON.parse(raw) as Partial<T>);
  } catch {
    return null;
  }
}
