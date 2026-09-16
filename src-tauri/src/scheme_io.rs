//! 方案导入导出（.miz）：应用专属的 zip 方案包。
//!
//! .miz 是一个 zip 压缩包，包内唯一条目 `miz.json`：
//! `{ "app": "mimibox", "format": 1, "kind": "<功能标识>", "schemes": [...] }`。
//! `kind` 用于校验方案包只能导入回对应的功能（抽奖/夯到拉/赛事预测/评分）。
//! 文件对话框由前端 `@tauri-apps/plugin-dialog` 弹出，这里只负责读写文件。

use std::fs;
use std::io::{Read, Write};

use serde::Deserialize;
use serde_json::Value;

/// 方案包内承载元数据与方案列表的 JSON 条目名
const MIZ_ENTRY: &str = "miz.json";
/// 写入 payload 的应用标识，导入时校验
const MIZ_APP: &str = "mimibox";

#[derive(Deserialize)]
struct MizHeader {
    app: String,
    kind: String,
}

/// 把方案包（payload 为完整 miz.json 内容）写入 path
#[tauri::command]
pub fn scheme_io_write(path: String, payload: Value) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
    let file =
        fs::File::create(&path).map_err(|e| format!("无法创建文件 {path}: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    zip.start_file(MIZ_ENTRY, options)
        .map_err(|e| format!("无法打包方案: {e}"))?;
    zip.write_all(json.as_bytes())
        .map_err(|e| format!("无法写入方案包: {e}"))?;
    zip.finish().map_err(|e| format!("无法完成方案包: {e}"))?;
    Ok(())
}

/// 读取方案包并校验应用标识与功能 kind，通过则返回 miz.json 的完整内容
#[tauri::command]
pub fn scheme_io_read(path: String, kind: String) -> Result<Value, String> {
    let file = fs::File::open(&path).map_err(|e| format!("无法打开文件 {path}: {e}"))?;
    let mut zip =
        zip::ZipArchive::new(file).map_err(|_| "不是有效的 zip 方案包".to_string())?;
    let mut entry = zip
        .by_name(MIZ_ENTRY)
        .map_err(|_| "不是有效的 MimiBox 方案包".to_string())?;
    let mut text = String::new();
    entry
        .read_to_string(&mut text)
        .map_err(|e| format!("无法读取方案包内容: {e}"))?;
    let value: Value =
        serde_json::from_str(&text).map_err(|_| "方案包内容已损坏".to_string())?;
    let header: MizHeader = serde_json::from_value(value.clone())
        .map_err(|_| "不是有效的 MimiBox 方案包".to_string())?;
    if header.app != MIZ_APP {
        return Err("不是 MimiBox 方案包".to_string());
    }
    if header.kind != kind {
        return Err("方案包来自其他功能，无法导入到当前功能".to_string());
    }
    Ok(value)
}
