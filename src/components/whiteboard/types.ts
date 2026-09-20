/** 白板数据类型（与 src-tauri/src/whiteboard/mod.rs 的 DTO 对应，camelCase） */

/** 背景图：压缩后的 data URL + 压缩后像素尺寸（用于计算 contain 显示区域） */
export type BoardBackground = {
  image: string;
  width: number;
  height: number;
};

/** 贴图：比例坐标（0-1，相对背景显示区域），width 为宽度占比，ratio 为高/宽比 */
export type BoardItem = {
  id: string;
  image: string;
  x: number;
  y: number;
  width: number;
  ratio: number;
};

export type WhiteboardData = {
  background: BoardBackground | null;
  items: BoardItem[];
};

export const emptyWhiteboardData = (): WhiteboardData => ({
  background: null,
  items: [],
});

/** 贴图宽度占比的取值范围 */
export const MIN_ITEM_WIDTH = 0.04;
export const MAX_ITEM_WIDTH = 1;

/** 新贴图的默认宽度占比 */
export const DEFAULT_ITEM_WIDTH = 0.18;
