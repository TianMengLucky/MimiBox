//! 各功能模块 scheme 数据文件的通用读写：位于应用数据目录。
//!
//! `rating`/`bobing`/`lottery`/`prediction`/`tierlist` 共用；
//! `account` 的 accounts.json 因含迁移与多账号会话逻辑，保持独立实现。
//! 文件不存在时返回默认值；解析失败（如被手动改坏）降级为默认值，不让应用崩溃。

use std::fs;
use std::path::PathBuf;

use serde::de::DeserializeOwned;
use serde::Serialize;
use tauri::{AppHandle, Manager};

/// 应用数据目录（不存在则创建）；tierlist 图片导出等也复用
pub(crate) fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
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

fn data_path(app: &AppHandle, file_name: &str) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join(file_name))
}

/// 整体读取 scheme 数据；文件缺失或解析失败时返回 `T::default()`
pub(crate) fn load<T: Default + DeserializeOwned>(
    app: &AppHandle,
    file_name: &str,
    label: &str,
) -> Result<T, String> {
    let path = data_path(app, file_name)?;
    if !path.exists() {
        return Ok(T::default());
    }
    let text = fs::read_to_string(&path)
        .map_err(|e| format!("无法读取{label} {}: {e}", path.display()))?;
    Ok(serde_json::from_str(&text).unwrap_or_default())
}

/// 整体写入 scheme 数据（pretty JSON）
pub(crate) fn save<T: Serialize>(
    app: &AppHandle,
    file_name: &str,
    label: &str,
    data: &T,
) -> Result<(), String> {
    let path = data_path(app, file_name)?;
    let text = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| format!("无法写入{label} {}: {e}", path.display()))
}
