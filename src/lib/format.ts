/** 跨功能共享的时间/大小格式化工具 */

/** Unix 毫秒时间戳 → 本地时间文本（zh-CN，24 小时制） */
export function formatTime(time: number): string {
  return new Date(time).toLocaleString("zh-CN", { hour12: false });
}

/** 字节数转人类可读大小（如 12.3 MB） */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exp = Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1);
  const value = bytes / 2 ** (10 * exp);
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[exp]}`;
}
