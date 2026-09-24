//! 应用数据目录定位：账号服务、插件宿主能力（HostApi::data_dir）与
//! 欢迎流程配置文件共用。各插件的数据文件读写已收敛到插件 SDK 的
//! `store` 工具（经 HostApi 在插件侧完成）。

use std::fs;
use std::path::PathBuf;

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
