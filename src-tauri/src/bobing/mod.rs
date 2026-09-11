//! 博饼功能（bobing.json）：掷骰历史记录的类型与命令入口。
//!
//! - `BobingData`：磁盘上的完整数据（仅历史记录，彩头判定在前端完成）
//! - `bobing_load`/`bobing_save`：整体读写的唯一入口，由前端在数据变化时保存

mod store;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

/// 单次博饼历史记录
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BobingHistoryEntry {
    pub id: String,
    /// 六颗骰子的点数（1-6）
    pub dice: Vec<u8>,
    /// 彩头等级 id（前端 rules.ts 判定结果）
    pub rank_id: String,
    pub rank_name: String,
    /// Unix 时间戳（毫秒）
    pub time: i64,
}

/// 保存到应用数据目录 bobing.json 的完整数据
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BobingData {
    #[serde(default)]
    pub history: Vec<BobingHistoryEntry>,
}

#[tauri::command]
pub fn bobing_load(app: AppHandle) -> Result<BobingData, String> {
    store::load(&app)
}

#[tauri::command]
pub fn bobing_save(app: AppHandle, data: BobingData) -> Result<(), String> {
    store::save(&app, &data)
}
