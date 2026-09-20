//! B 站直播弹幕姬：连接指定 B 站账号的直播间，实时解析弹幕协议
//! 并以 Tauri 事件推送给弹幕窗口（label `danmaku`）。
//!
//! - [`protocol`]：弹幕协议封包/解包（16 字节头 + brotli 压缩体）
//! - [`client`]：连接生命周期管理（解析直播间、认证、心跳、断线重连、命令）
//!
//! 协议解析全部在 Rust 端完成，前端只消费已解析的弹幕 DTO。

pub(crate) mod client;
mod protocol;

use std::collections::VecDeque;
use std::sync::atomic::AtomicU64;
use std::sync::Mutex;

/// 交给前端的单条弹幕（`danmaku-message` 事件载荷）
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DanmakuMessage {
    /// 会话内自增序号（前端列表 key）
    pub id: u64,
    pub uid: u64,
    pub uname: String,
    pub avatar: String,
    pub text: String,
    pub medal_name: Option<String>,
    pub medal_level: Option<u32>,
    /// 舰队身份：0=普通 1=总督 2=提督 3=舰长
    pub guard: u32,
}

/// 交给前端的连接状态（`danmaku-status` 事件载荷）
#[derive(Clone, serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DanmakuStatus {
    /// connecting / connected / reconnecting / disconnected
    pub state: &'static str,
    /// 断线原因等补充信息
    pub message: Option<String>,
    pub room_id: Option<u64>,
    pub room_title: Option<String>,
    /// 心跳返回的直播间人气值
    pub viewers: Option<u64>,
}

/// 连接成功后返回给主窗口的直播间信息
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomInfo {
    pub room_id: u64,
    pub title: String,
    /// 是否正在直播（未开播也能连弹幕，仅用于前端提示）
    pub live_status: bool,
}

/// 弹幕窗口打开时的补发快照：当前状态 + 最近一条缓冲区里的弹幕
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DanmakuSnapshot {
    pub status: DanmakuStatus,
    pub messages: Vec<DanmakuMessage>,
}

/// 弹幕姬全局状态：唯一的连接任务 + 最新状态 + 最近弹幕环形缓冲
#[derive(Default)]
pub struct DanmakuState {
    conn: Mutex<Option<client::ConnectionHandle>>,
    status: Mutex<DanmakuStatus>,
    /// 窗口晚于连接打开时补发（上限见 [`RECENT_LIMIT`]）
    recent: Mutex<VecDeque<DanmakuMessage>>,
    seq: AtomicU64,
}

/// 最近弹幕缓冲上限（窗口打开补发用）
pub(crate) const RECENT_LIMIT: usize = 100;

impl DanmakuState {
    /// 记录一条弹幕到环形缓冲，并作为事件广播给所有窗口
    pub(crate) fn publish_message(&self, app: &tauri::AppHandle, message: DanmakuMessage) {
        let mut recent = self.recent.lock().unwrap();
        recent.push_back(message.clone());
        while recent.len() > RECENT_LIMIT {
            recent.pop_front();
        }
        drop(recent);
        use tauri::Emitter;
        let _ = app.emit("danmaku-message", &message);
    }

    /// 更新连接状态并广播给所有窗口
    pub(crate) fn publish_status(&self, app: &tauri::AppHandle, status: DanmakuStatus) {
        *self.status.lock().unwrap() = status.clone();
        use tauri::Emitter;
        let _ = app.emit("danmaku-status", &status);
    }

    /// 当前状态 + 最近弹幕（弹幕窗口/主页挂载时补齐）
    pub(crate) fn snapshot(&self) -> DanmakuSnapshot {
        DanmakuSnapshot {
            status: self.status.lock().unwrap().clone(),
            messages: self.recent.lock().unwrap().iter().cloned().collect(),
        }
    }

    /// 中断当前连接任务（若有）
    pub(crate) fn shutdown(&self) {
        if let Some(handle) = self.conn.lock().unwrap().take() {
            handle.task.abort();
        }
    }

    /// 记录新的连接任务句柄
    pub(crate) fn attach(&self, task: tokio::task::JoinHandle<()>) {
        *self.conn.lock().unwrap() = Some(client::ConnectionHandle { task });
    }
}

/// B 站专属命令（连接/断开/快照）从 [`client`] re-export，
/// Tauri 命令注册路径保持 `bilibili_danmaku::*` 不变。
pub use client::{danmaku_connect, danmaku_disconnect, danmaku_open, danmaku_snapshot};
