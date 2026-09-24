//! 番剧插件后端：从 Bangumi（bgm.tv）获取每日放送时间表。
//!
//! 命令与插件化前完全同名（bangumi_calendar），行为不变；
//! 时间表带内存缓存（30 分钟），避免频繁请求上游。

mod calendar;

use mimibox_plugin::{export_plugin, InvokeCtx, PluginBackend, Registry};
use serde::Serialize;

/// 时间表里的单个条目（仅保留展示所需字段，camelCase 对应前端）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarItem {
    pub id: u32,
    /// 条目页 URL（https://bgm.tv/subject/{id}）
    pub url: String,
    /// 原名（日文）
    pub name: String,
    /// 中文名（可能为空）
    pub name_cn: String,
    /// 开播日期（YYYY-MM-DD）
    pub air_date: String,
    /// 封面图 URL
    pub image: String,
    /// Bangumi 评分（0-10，无评分时为 0）
    pub score: f32,
}

/// 一周中某天的放送列表
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeekdayCalendar {
    /// Bangumi 星期编号（1=周一 … 7=周日）
    pub weekday: u8,
    /// 中文星期名（如「星期一」）
    pub weekday_cn: String,
    pub items: Vec<CalendarItem>,
}

struct AnimePlugin;

impl PluginBackend for AnimePlugin {
    fn register(&self, registry: &mut Registry) {
        // 获取每日放送时间表（内存缓存 30 分钟）
        registry.handle("bangumi_calendar", |_ctx: InvokeCtx, _args: ()| async move {
            calendar::fetch().await
        });
    }
}

export_plugin!(AnimePlugin);
