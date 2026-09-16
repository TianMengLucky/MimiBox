//! 夯到拉排名表（tierlist.json）：梯队方案的类型与命令入口。
//!
//! - `TierListData`：磁盘上的完整数据（方案列表 + 活动方案）
//! - `tierlist_load`/`tierlist_save`：整体读写的唯一入口，由前端在数据变化时保存
//! - `tierlist_export_image`：把前端画好的排名图 PNG 写入数据目录 exports/ 并在资源管理器中定位

use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::scheme_store;

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
    scheme_store::load(&app, "tierlist.json", "排名数据")
}

#[tauri::command]
pub fn tierlist_save(app: AppHandle, data: TierListData) -> Result<(), String> {
    scheme_store::save(&app, "tierlist.json", "排名数据", &data)
}

/// 保存排名图 PNG（data URL 由前端生成），成功后返回文件完整路径
#[tauri::command]
pub fn tierlist_export_image(
    app: AppHandle,
    name: String,
    data_url: String,
) -> Result<String, String> {
    export_image(&app, &name, &data_url)
}

/// 去掉文件名中的非法字符；清理后为空则用默认名
fn sanitize_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => ' ',
            other => other,
        })
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        "排名表".to_string()
    } else {
        trimmed.to_string()
    }
}

/// 把前端生成的 PNG data URL 写入 exports/，文件名带时间戳避免覆盖，
/// 成功后在资源管理器中定位该文件并返回完整路径。
fn export_image(app: &AppHandle, name: &str, data_url: &str) -> Result<String, String> {
    let exports_dir = scheme_store::data_dir(app)?.join("exports");
    fs::create_dir_all(&exports_dir)
        .map_err(|e| format!("无法创建导出目录 {}: {e}", exports_dir.display()))?;

    let payload = data_url
        .strip_prefix("data:image/png;base64,")
        .ok_or_else(|| "图片格式不正确，仅支持 PNG data URL".to_string())?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload)
        .map_err(|e| format!("图片解码失败: {e}"))?;

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    let file_name = format!("{}-{stamp}.png", sanitize_name(name));
    let path = exports_dir.join(file_name);
    fs::write(&path, &bytes).map_err(|e| format!("无法写入排名图 {}: {e}", path.display()))?;

    if let Err(e) = app.opener().reveal_item_in_dir(&path) {
        // 定位失败不算导出失败，图片已经保存成功
        eprintln!("定位导出文件失败: {e}");
    }
    Ok(path.display().to_string())
}
