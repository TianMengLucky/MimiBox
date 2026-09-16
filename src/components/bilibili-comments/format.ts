/** B 站评论区功能的展示格式化工具 */

/** 播放/点赞数：过万缩写为「1.2万」 */
export function formatCount(value: number): string {
  if (value >= 10000) {
    const wan = value / 10000;
    return `${wan >= 100 ? Math.round(wan) : wan.toFixed(1).replace(/\.0$/, "")}万`;
  }
  return String(value);
}

/** Unix 秒 → 相对时间（刚刚 / n 分钟前 / n 小时前 / n 天前 / 日期） */
export function formatRelative(seconds: number): string {
  if (!seconds) return "未知时间";
  const diff = Date.now() / 1000 - seconds;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
  return new Date(seconds * 1000).toLocaleDateString("zh-CN");
}
