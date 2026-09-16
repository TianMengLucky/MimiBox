//! 评分（rating.json）：批量导入选项并打 1-10 分的方案的类型与命令入口。
//!
//! - `RatingData`：磁盘上的完整数据（方案列表 + 活动方案）
//! - `rating_load`/`rating_save`：整体读写的唯一入口，由前端在数据变化时保存
//!
//! 数据结构与前端 `src/components/rating/types.ts` 对应（camelCase）。
//! 评分（`score`）为 1-10 的一位小数，`None` 表示尚未评分。

use crate::scheme_store;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

/// 评分条目：名称 + 评分（1-10 一位小数，None 未评）+ 添加时间（ms 时间戳）
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RatingItem {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub score: Option<f64>,
    #[serde(default)]
    pub created_at: u64,
}

/// 评分方案：一批待评选项
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RatingScheme {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub items: Vec<RatingItem>,
}

/// 保存到应用数据目录 rating.json 的完整数据
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RatingData {
    #[serde(default)]
    pub schemes: Vec<RatingScheme>,
    #[serde(default)]
    pub active_scheme_id: Option<String>,
}

#[tauri::command]
pub fn rating_load(app: AppHandle) -> Result<RatingData, String> {
    scheme_store::load(&app, "rating.json", "评分数据")
}

#[tauri::command]
pub fn rating_save(app: AppHandle, data: RatingData) -> Result<(), String> {
    scheme_store::save(&app, "rating.json", "评分数据", &data)
}
