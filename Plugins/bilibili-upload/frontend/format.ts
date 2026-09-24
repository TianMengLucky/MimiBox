/** B 站投稿功能的展示格式化工具（通用时间/大小格式化在宿主 @lib/format） */

/** 字数（按 Unicode 码点计数，与 B 站标题 80 字限制对齐） */
export function charCount(text: string): number {
  return [...text].length;
}
