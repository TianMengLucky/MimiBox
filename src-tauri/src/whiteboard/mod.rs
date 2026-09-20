//! 白板（whiteboard.json）：背景图与可自由摆放的贴图条目。
//!
//! - `WhiteboardData`：磁盘上的完整数据（背景图 + 贴图列表）
//! - `whiteboard_load`/`whiteboard_save`：整体读写的唯一入口，由前端在数据变化时保存

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::scheme_store;

/// 背景图：前端压缩后的 JPEG data URL + 压缩后的像素尺寸（用于按 contain 计算显示区域）
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BoardBackground {
    pub image: String,
    pub width: u32,
    pub height: u32,
}

/// 贴图条目：图片（PNG data URL）+ 相对背景显示区域的比例坐标（0-1）。
/// `x`/`y` 为贴图左上角位置，`width` 为贴图宽度占背景宽度的比例，
/// `ratio` 为贴图高宽比（高/宽），由前端在导入时读取原图尺寸写入。
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BoardItem {
    pub id: String,
    pub image: String,
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default = "default_item_width")]
    pub width: f64,
    #[serde(default = "default_item_ratio")]
    pub ratio: f64,
}

fn default_item_width() -> f64 {
    0.18
}

fn default_item_ratio() -> f64 {
    1.0
}

/// 保存到应用数据目录 whiteboard.json 的完整数据
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WhiteboardData {
    #[serde(default)]
    pub background: Option<BoardBackground>,
    #[serde(default)]
    pub items: Vec<BoardItem>,
}

#[tauri::command]
pub fn whiteboard_load(app: AppHandle) -> Result<WhiteboardData, String> {
    scheme_store::load(&app, "whiteboard.json", "白板数据")
}

#[tauri::command]
pub fn whiteboard_save(app: AppHandle, data: WhiteboardData) -> Result<(), String> {
    scheme_store::save(&app, "whiteboard.json", "白板数据", &data)
}
