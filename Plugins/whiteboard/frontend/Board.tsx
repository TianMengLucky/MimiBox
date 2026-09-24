import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Icon } from "@iconify/react";
import { FileDropZone } from "@components/FileDropZone";
import { MAX_ITEM_WIDTH, MIN_ITEM_WIDTH } from "./types";
import type { BoardItem, WhiteboardData } from "./types";

/** 背景图在画板内按 contain 拟合后的显示区域（像素） */
type Rect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** 一次拖动/缩放会话的起始信息（坐标比例在 move 时结合 rect 换算） */
type DragInfo =
  | {
      mode: "move";
      id: string;
      pointerId: number;
      startClientX: number;
      startClientY: number;
      startX: number;
      startY: number;
    }
  | {
      mode: "resize";
      id: string;
      pointerId: number;
      startClientX: number;
      startClientY: number;
      startWidth: number;
    };

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * 白板画板：背景图 contain 居中显示，贴图绝对定位在背景显示区域内，
 * 指针拖动移动、右下角手柄缩放；贴图数组顺序即叠放层级（末尾在最上）。
 */
export function Board({
  data,
  selectedId,
  onSelect,
  onUpdateItem,
  onDeleteItem,
  onDropFiles,
}: {
  data: WhiteboardData;
  /** 当前选中的贴图 id（用于高亮与删除键） */
  selectedId: string | null;
  /** 选中贴图（同时会把该贴图移到最上层） */
  onSelect: (id: string) => void;
  /** 更新某个贴图的位置/大小 */
  onUpdateItem: (id: string, patch: Partial<Pick<BoardItem, "x" | "y" | "width">>) => void;
  /** 删除某个贴图 */
  onDeleteItem: (id: string) => void;
  /** 把拖入 / 选择的图片文件交给页面处理（无坐标时由页面自行摆放） */
  onDropFiles: (files: File[], at?: { x: number; y: number }) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [container, setContainer] = useState({ width: 0, height: 0 });
  const dragRef = useRef<DragInfo | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // 容器尺寸测量：贴图定位依赖背景显示区域，容器变化（窗口缩放）时重算
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainer({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const rect = useMemo<Rect | null>(() => {
    const bg = data.background;
    if (!bg || container.width <= 0 || container.height <= 0) return null;
    const scale = Math.min(container.width / bg.width, container.height / bg.height);
    const width = bg.width * scale;
    const height = bg.height * scale;
    return {
      left: (container.width - width) / 2,
      top: (container.height - height) / 2,
      width,
      height,
    };
  }, [data.background, container]);

  const startDrag = (
    event: ReactPointerEvent<HTMLElement>,
    item: BoardItem,
    mode: "move" | "resize",
  ) => {
    if (!rect) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current =
      mode === "move"
        ? {
            mode,
            id: item.id,
            pointerId: event.pointerId,
            startClientX: event.clientX,
            startClientY: event.clientY,
            startX: item.x,
            startY: item.y,
          }
        : {
            mode,
            id: item.id,
            pointerId: event.pointerId,
            startClientX: event.clientX,
            startClientY: event.clientY,
            startWidth: item.width,
          };
    setDraggingId(item.id);
    if (mode === "move") onSelect(item.id);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || !rect || drag.pointerId !== event.pointerId) return;
    const dx = (event.clientX - drag.startClientX) / rect.width;
    if (drag.mode === "resize") {
      onUpdateItem(drag.id, {
        width: clamp(drag.startWidth + dx, MIN_ITEM_WIDTH, MAX_ITEM_WIDTH),
      });
      return;
    }
    const item = data.items.find((entry) => entry.id === drag.id);
    if (!item) return;
    const dy = (event.clientY - drag.startClientY) / rect.height;
    onUpdateItem(drag.id, {
      x: clamp(drag.startX + dx, 0, Math.max(0, 1 - item.width)),
      y: clamp(drag.startY + dy, 0, Math.max(0, 1 - item.width * item.ratio)),
    });
  };

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDraggingId(null);
  };

  /** 把窗口坐标换算为背景显示区域内的比例坐标（用于拖放落点） */
  const pointToFraction = (clientX: number, clientY: number) => {
    if (!rect) return undefined;
    return {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height,
    };
  };

  return (
    <div
      ref={containerRef}
      className="relative flex-1 min-h-0 touch-none select-none overflow-hidden rounded-2xl border border-[#f0dce5] bg-white/45"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        onDropFiles(
          Array.from(event.dataTransfer.files),
          pointToFraction(event.clientX, event.clientY),
        );
      }}
    >
      {data.background && rect ? (
        <>
          <img
            src={data.background.image}
            alt="白板背景"
            draggable={false}
            className="pointer-events-none absolute rounded-lg shadow-sm"
            style={{
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            }}
          />
          {data.items.map((item, index) => {
            const selected = item.id === selectedId;
            return (
              <div
                key={item.id}
                className={`group absolute cursor-grab rounded-lg ${
                  selected
                    ? "ring-2 ring-[#d26d9a]"
                    : "ring-1 ring-black/10 hover:ring-[#d26d9a]/60"
                } ${draggingId === item.id ? "cursor-grabbing" : ""}`}
                style={{
                  left: rect.left + item.x * rect.width,
                  top: rect.top + item.y * rect.height,
                  width: item.width * rect.width,
                  zIndex: index + 1,
                }}
                onPointerDown={(event) => startDrag(event, item, "move")}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                <img
                  src={item.image}
                  alt=""
                  draggable={false}
                  className="pointer-events-none block h-auto w-full rounded-lg shadow-md"
                  style={{ aspectRatio: `1 / ${item.ratio}` }}
                />
                {/* 删除按钮：悬停或选中时出现在右上角 */}
                <button
                  type="button"
                  aria-label="删除贴图"
                  className={`absolute -right-2.5 -top-2.5 flex h-6 w-6 items-center justify-center rounded-full bg-rose-500 text-white shadow-md transition-opacity hover:bg-rose-600 ${
                    selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  }`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteItem(item.id);
                  }}
                >
                  <Icon icon="lucide:x" width="14" height="14" aria-hidden="true" />
                </button>
                {/* 右下角缩放手柄 */}
                <div
                  role="separator"
                  aria-label="调整贴图大小"
                  className={`absolute -bottom-1.5 -right-1.5 h-4 w-4 cursor-nwse-resize rounded-full border-2 border-white bg-[#d26d9a] shadow ${
                    selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  }`}
                  onPointerDown={(event) => startDrag(event, item, "resize")}
                  onPointerMove={onPointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                />
              </div>
            );
          })}
        </>
      ) : (
        <div className="flex h-full items-center justify-center p-6">
          <FileDropZone
            accept="image/*"
            icon="lucide:image-plus"
            title="上传背景图片"
            hint="点击选择，或把图片拖到这里"
            onFiles={(files) => onDropFiles(files)}
          />
        </div>
      )}
    </div>
  );
}
