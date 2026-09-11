//! 夯到拉排名表（tierlist.json）：梯队方案的类型与命令入口。
//!
//! - `TierListData`：磁盘上的完整数据（方案列表 + 活动方案）
//! - `tierlist_load`/`tierlist_save`：整体读写的唯一入口，由前端在数据变化时保存
//! - `tierlist_export_image`：把前端画好的排名图 PNG 写入数据目录 exports/ 并在资源管理器中定位

mod store;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

/// 排名条目：图片（前端压缩后的 PNG data URL）+ 可选名称
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TierItem {
    pub id: String,
    #[serde(default)]
    pub name: String,
    pub image: String,
}

/// 一个梯队：名称 + 底色 + 已归类的条目
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Tier {
    pub id: String,
    pub name: String,
    pub color: String,
    #[serde(default)]
    pub items: Vec<TierItem>,
}

/// 排名方案：梯队列表 + 待排图片池
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TierListScheme {
    pub id: String,
    pub name: String,
    pub tiers: Vec<Tier>,
    #[serde(default)]
    pub pool: Vec<TierItem>,
}

/// 保存到应用数据目录 tierlist.json 的完整数据
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TierListData {
    #[serde(default)]
    pub schemes: Vec<TierListScheme>,
    #[serde(default)]
    pub active_scheme_id: Option<String>,
}

#[tauri::command]
pub fn tierlist_load(app: AppHandle) -> Result<TierListData, String> {
    store::load(&app)
}

#[tauri::command]
pub fn tierlist_save(app: AppHandle, data: TierListData) -> Result<(), String> {
    store::save(&app, &data)
}

/// 保存排名图 PNG（data URL 由前端生成），成功后返回文件完整路径
#[tauri::command]
pub fn tierlist_export_image(
    app: AppHandle,
    name: String,
    data_url: String,
) -> Result<String, String> {
    store::export_image(&app, &name, &data_url)
}
