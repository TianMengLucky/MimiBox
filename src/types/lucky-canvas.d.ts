// @lucky-canvas/react@0.1.13 未随包发布类型定义（package.json 指向的 types 文件不存在），
// 这里按其实际 API 补充声明，并通过 tsconfig.json 的 paths 映射到本文件。
import type { Component } from "react";

/** 转盘文字 */
export interface LuckyFont {
  text: string;
  fontSize?: string | number;
  fontColor?: string;
  fontStyle?: string;
  fontWeight?: string | number;
  lineHeight?: string | number;
  /** 相对扇区的纵向偏移（百分比字符串或像素数字） */
  top?: string | number;
}

/** 转盘图片（奖品图 / 区块图） */
export interface LuckyImage {
  src: string;
  width?: string | number;
  height?: string | number;
  top?: string | number;
  rotate?: boolean;
}

/** 转盘奖品扇区 */
export interface LuckyPrize {
  title?: string;
  background?: string;
  fonts?: LuckyFont[];
  imgs?: LuckyImage[];
}

/** 转盘中央按钮（多层圆，pointer 层显示指针） */
export interface LuckyButton {
  radius?: string | number;
  background?: string;
  fonts?: LuckyFont[];
  pointer?: boolean;
}

/** 转盘装饰环（由外到内） */
export interface LuckyBlock {
  padding?: string | number;
  background?: string;
  borderRadius?: string | number;
  imgs?: LuckyImage[];
}

export interface WheelDefaultConfig {
  stopTime?: number;
  accelerationTime?: number;
  decelerationTime?: number;
  gutter?: string | number;
  speed?: number;
}

export interface WheelDefaultStyle {
  fontSize?: string | number;
  fontColor?: string;
  fontStyle?: string;
  fontWeight?: string | number;
  background?: string;
}

export interface LuckyWheelProps {
  width?: string;
  height?: string;
  blocks?: LuckyBlock[];
  prizes?: LuckyPrize[];
  buttons?: LuckyButton[];
  defaultStyle?: WheelDefaultStyle;
  defaultConfig?: WheelDefaultConfig;
  /** 点击转盘中央按钮时触发（在此调用 play） */
  onStart?: (event?: unknown) => void;
  /** 停止落定后触发（prize 为 stop 传入索引对应的扇区） */
  onEnd?: (prize: LuckyPrize) => void;
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
  onFinally?: () => void;
}

/** 类组件：可通过 ref 调用 play / stop */
export class LuckyWheel extends Component<LuckyWheelProps> {
  play(...args: unknown[]): void;
  stop(index?: number): void;
}

export class LuckyGrid extends Component<LuckyWheelProps> {
  play(...args: unknown[]): void;
  stop(index?: number): void;
}

export class SlotMachine extends Component<LuckyWheelProps> {
  play(...args: unknown[]): void;
  stop(index?: number): void;
}
