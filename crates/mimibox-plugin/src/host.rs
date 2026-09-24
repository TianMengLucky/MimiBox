//! 宿主能力抽象：插件可用的宿主服务接口。
//!
//! 同一 trait 有两个实现：内置插件拿到宿主直连实现（`HostImpl`，宿主内），
//! 磁盘插件拿到 FFI 实现（[`crate::ffi::FfiHost`]）。插件代码只依赖本 trait。

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// 当前 B 站账号凭据（Cookie 请求头 + mid）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BiliCredentials {
    pub mid: u64,
    pub cookie: String,
}

/// 日志级别（宿主侧输出到控制台 / 日志）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogLevel {
    Info,
    Warn,
    Error,
}

/// 创建独立窗口的参数（如弹幕直播姬的悬浮窗）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowOptions {
    /// Tauri 窗口 label（capabilities 按此授权）
    pub label: String,
    pub title: String,
    /// 前端路由路径（如 `/w/danmaku`）
    pub path: String,
    pub width: f64,
    pub height: f64,
    pub min_width: Option<f64>,
    pub min_height: Option<f64>,
    /// 无边框窗口（配合前端自绘标题栏）
    pub decorations: bool,
}

/// 宿主向插件开放的能力集合
pub trait HostApi: Send + Sync + 'static {
    /// 应用数据目录（不存在则创建）；插件在此读写自己的 JSON 数据文件
    fn data_dir(&self) -> Result<PathBuf, String>;

    /// 向所有窗口广播 Tauri 事件（如弹幕消息、上传进度）
    fn emit(&self, event: &str, payload: &serde_json::Value) -> Result<(), String>;

    /// B 站账号凭据；`mid` 为 None 时取当前活动账号，未登录返回错误
    fn bili_credentials(&self, mid: Option<&str>) -> Result<BiliCredentials, String>;

    /// 指定 label 的窗口是否已存在
    fn window_exists(&self, label: &str) -> bool;

    /// 创建独立窗口
    fn create_window(&self, options: &WindowOptions) -> Result<(), String>;

    /// 显示并聚焦已存在的窗口
    fn focus_window(&self, label: &str) -> Result<(), String>;

    /// 在系统文件管理器中定位（选中）指定文件/目录
    fn reveal_path(&self, path: &str) -> Result<(), String>;
}
