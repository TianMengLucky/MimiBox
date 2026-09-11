//! lottery.json 读写：位于应用数据目录。
//!
//! 文件不存在时返回空数据；解析失败（如被手动改坏）降级为空数据，不让应用崩溃。

use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use super::LotteryData;

fn data_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法解析应用数据目录: {e}"))?;
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("无法创建数据目录 {}: {e}", dir.display()))?;
    }
    Ok(dir.join("lottery.json"))
}

pub(super) fn load(app: &AppHandle) -> Result<LotteryData, String> {
    let path = data_path(app)?;
    if !path.exists() {
        return Ok(LotteryData::default());
    }
    let text = fs::read_to_string(&path)
        .map_err(|e| format!("无法读取抽奖数据 {}: {e}", path.display()))?;
    Ok(serde_json::from_str(&text).unwrap_or_default())
}

pub(super) fn save(app: &AppHandle, data: &LotteryData) -> Result<(), String> {
    let path = data_path(app)?;
    let text = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| format!("无法写入抽奖数据 {}: {e}", path.display()))
}
