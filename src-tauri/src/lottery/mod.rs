//! 抽奖功能（lottery.json）：转盘方案、奖品与历史记录的类型与命令入口。
//!
//! - `LotteryData`：磁盘上的完整数据（方案列表 + 活动方案 + 历史记录）
//! - `lottery_load`/`lottery_save`：整体读写的唯一入口，由前端在数据变化时保存

mod store;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

/// 转盘奖品：名称 + 可选图片（前端压缩后的 PNG data URL）
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LotteryPrize {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub image: Option<String>,
}

/// 抽奖方案：一组奖品，可新建/切换/删除
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LotteryScheme {
    pub id: String,
    pub name: String,
    pub prizes: Vec<LotteryPrize>,
}

/// 单条抽奖历史记录
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LotteryHistoryEntry {
    pub id: String,
    pub scheme_id: String,
    pub scheme_name: String,
    pub prize_id: String,
    pub prize_name: String,
    /// Unix 时间戳（毫秒）
    pub time: i64,
}

/// 保存到应用数据目录 lottery.json 的完整数据
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LotteryData {
    #[serde(default)]
    pub schemes: Vec<LotteryScheme>,
    #[serde(default)]
    pub active_scheme_id: Option<String>,
    #[serde(default)]
    pub history: Vec<LotteryHistoryEntry>,
}

#[tauri::command]
pub fn lottery_load(app: AppHandle) -> Result<LotteryData, String> {
    store::load(&app)
}

#[tauri::command]
pub fn lottery_save(app: AppHandle, data: LotteryData) -> Result<(), String> {
    store::save(&app, &data)
}
