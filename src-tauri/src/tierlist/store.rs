//! tierlist.json 与导出图片的读写：位于应用数据目录。
//!
//! 文件不存在时返回空数据；解析失败（如被手动改坏）降级为空数据，不让应用崩溃。

use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

use super::TierListData;

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法解析应用数据目录: {e}"))?;
    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|e| format!("无法创建数据目录 {}: {e}", dir.display()))?;
    }
    Ok(dir)
}

fn data_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("tierlist.json"))
}

pub(super) fn load(app: &AppHandle) -> Result<TierListData, String> {
    let path = data_path(app)?;
    if !path.exists() {
        return Ok(TierListData::default());
    }
    let text = fs::read_to_string(&path)
        .map_err(|e| format!("无法读取排名数据 {}: {e}", path.display()))?;
    Ok(serde_json::from_str(&text).unwrap_or_default())
}

pub(super) fn save(app: &AppHandle, data: &TierListData) -> Result<(), String> {
    let path = data_path(app)?;
    let text = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| format!("无法写入排名数据 {}: {e}", path.display()))
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
pub(super) fn export_image(app: &AppHandle, name: &str, data_url: &str) -> Result<String, String> {
    let exports_dir = data_dir(app)?.join("exports");
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
