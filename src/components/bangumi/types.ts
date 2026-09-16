/** Bangumi 每日放送数据（与 src-tauri/src/bangumi/mod.rs 的类型对应，camelCase） */

/** 时间表里的单个番剧条目 */
export interface BangumiCalendarItem {
  id: number;
  /** 条目页 URL（https://bgm.tv/subject/{id}） */
  url: string;
  /** 原名（日文） */
  name: string;
  /** 中文名（可能为空） */
  nameCn: string;
  /** 开播日期（YYYY-MM-DD） */
  airDate: string;
  /** 封面图 URL */
  image: string;
  /** Bangumi 评分（0-10，无评分时为 0） */
  score: number;
}

/** 一周中某天的放送列表 */
export interface BangumiWeekday {
  /** Bangumi 星期编号（1=周一 … 7=周日） */
  weekday: number;
  weekdayCn: string;
  items: BangumiCalendarItem[];
}
