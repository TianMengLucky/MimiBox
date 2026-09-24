//! B 站直播弹幕姬插件后端：连接指定 B 站账号的直播间，实时解析弹幕协议
//! 并以宿主事件推送给弹幕窗口（label `danmaku`）。
//!
//! - [`protocol`]：弹幕协议封包/解包（16 字节头 + brotli 压缩体）
//! - [`client`]：连接生命周期管理（解析直播间、认证、心跳、断线重连、命令）
//!
//! 协议解析全部在插件后端完成，前端只消费已解析的弹幕 DTO。
//! 连接任务驻留在插件自身的 tokio runtime（export_plugin 宏内置）。
//! 依赖账号服务（manifest requires: ["account"]）。

pub(crate) mod client;
mod protocol;

use std::collections::VecDeque;
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex};

use mimibox_plugin::{export_plugin, HostApi, InvokeCtx, PluginBackend, Registry};
use serde::Deserialize;

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

/// 最近弹幕缓冲上限（窗口打开补发用）
pub(crate) const RECENT_LIMIT: usize = 100;

/// 弹幕姬全局状态：唯一的连接任务 + 最新状态 + 最近弹幕环形缓冲。
/// 存放在插件实例内部（随插件加载，不再由宿主 app.manage 托管）。
pub(crate) struct DanmakuState {
    conn: Mutex<Option<client::ConnectionHandle>>,
    status: Mutex<DanmakuStatus>,
    /// 窗口晚于连接打开时补发（上限见 [`RECENT_LIMIT`]）
    recent: Mutex<VecDeque<DanmakuMessage>>,
    seq: AtomicU64,
}

impl Default for DanmakuState {
    fn default() -> Self {
        Self {
            conn: Mutex::new(None),
            status: Mutex::new(DanmakuStatus::default()),
            recent: Mutex::new(VecDeque::new()),
            seq: AtomicU64::new(0),
        }
    }
}

impl DanmakuState {
    /// 记录一条弹幕到环形缓冲，并作为事件广播给所有窗口
    pub(crate) fn publish_message(&self, host: &dyn HostApi, message: DanmakuMessage) {
        let mut recent = self.recent.lock().unwrap();
        recent.push_back(message.clone());
        while recent.len() > RECENT_LIMIT {
            recent.pop_front();
        }
        drop(recent);
        let payload = serde_json::to_value(&message).unwrap_or(serde_json::Value::Null);
        let _ = host.emit("danmaku-message", &payload);
    }

    /// 更新连接状态并广播给所有窗口
    pub(crate) fn publish_status(&self, host: &dyn HostApi, status: DanmakuStatus) {
        *self.status.lock().unwrap() = status.clone();
        let payload = serde_json::to_value(&status).unwrap_or(serde_json::Value::Null);
        let _ = host.emit("danmaku-status", &payload);
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

/// 命令入参
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ConnectArgs {
    mid: String,
}

/// 插件实例：持有弹幕连接状态（handler 经 Arc 共享）
struct DanmakuPlugin {
    state: Arc<DanmakuState>,
}

impl PluginBackend for DanmakuPlugin {
    fn register(&self, registry: &mut Registry) {
        // 打开（或聚焦已存在的）弹幕独立窗口：/w/danmaku 通用窗口路由
        registry.handle("danmaku_open", |ctx: InvokeCtx, _args: ()| async move {
            let options = mimibox_plugin::WindowOptions {
                label: "danmaku".to_string(),
                title: "弹幕姬 · 美美工具箱 X".to_string(),
                path: "/w/danmaku".to_string(),
                width: 420.0,
                height: 720.0,
                min_width: Some(300.0),
                min_height: Some(400.0),
                decorations: false,
            };
            ctx.host.create_window(&options)
        });

        // 连接指定 B 站账号（mid）的直播间弹幕；若已有连接会先断开
        let state = self.state.clone();
        registry.handle(
            "danmaku_connect",
            move |ctx: InvokeCtx, args: ConnectArgs| {
                let state = state.clone();
                async move { client::connect(&state, &ctx.host, &args.mid).await }
            },
        );

        let state = self.state.clone();
        registry.handle(
            "danmaku_disconnect",
            move |ctx: InvokeCtx, _args: ()| {
                let state = state.clone();
                async move {
                    state.shutdown();
                    state.publish_status(
                        &*ctx.host,
                        DanmakuStatus {
                            state: "disconnected",
                            message: None,
                            room_id: None,
                            room_title: None,
                            viewers: None,
                        },
                    );
                    Ok(())
                }
            },
        );

        // 当前状态 + 最近弹幕缓冲（弹幕窗口/主页挂载时补齐错过的内容）
        let state = self.state.clone();
        registry.handle(
            "danmaku_snapshot",
            move |_ctx: InvokeCtx, _args: ()| {
                let state = state.clone();
                async move { Ok::<_, String>(state.snapshot()) }
            },
        );
    }
}

/// 构造插件实例（注册时由 export_plugin 宏调用一次，连接状态随之建立）
fn make_plugin() -> DanmakuPlugin {
    DanmakuPlugin {
        state: Arc::new(DanmakuState::default()),
    }
}

export_plugin!(make_plugin());
