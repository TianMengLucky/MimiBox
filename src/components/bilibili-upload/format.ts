/** 字节数转人类可读大小（如 12.3 MB） */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exp = Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1);
  const value = bytes / 2 ** (10 * exp);
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[exp]}`;
}

/** 字数（按 Unicode 码点计数，与 B 站标题 80 字限制对齐） */
export function charCount(text: string): number {
  return [...text].length;
}
