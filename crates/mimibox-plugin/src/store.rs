//! JSON 持久化：插件数据文件的通用读写（原宿主 `scheme_store` 的 SDK 化版本）。
//!
//! 文件位于应用数据目录（[`HostApi::data_dir`]）。文件不存在时返回默认值；
//! 解析失败（如被手动改坏）降级为默认值，不让应用崩溃。

use std::fs;
use std::path::PathBuf;

use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::host::HostApi;

/// 数据文件完整路径（相对应用数据目录）
pub fn data_path(host: &dyn HostApi, file_name: &str) -> Result<PathBuf, String> {
    Ok(host.data_dir()?.join(file_name))
}

/// 整体读取数据文件；文件缺失或解析失败时返回 `T::default()`
pub fn load<T: Default + DeserializeOwned>(
    host: &dyn HostApi,
    file_name: &str,
    label: &str,
) -> Result<T, String> {
    let path = data_path(host, file_name)?;
    if !path.exists() {
        return Ok(T::default());
    }
    let text = fs::read_to_string(&path)
        .map_err(|e| format!("无法读取{label} {}: {e}", path.display()))?;
    Ok(serde_json::from_str(&text).unwrap_or_default())
}

/// 整体写入数据文件（pretty JSON）
pub fn save<T: Serialize>(
    host: &dyn HostApi,
    file_name: &str,
    label: &str,
    data: &T,
) -> Result<(), String> {
    let path = data_path(host, file_name)?;
    let text = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| format!("无法写入{label} {}: {e}", path.display()))
}
