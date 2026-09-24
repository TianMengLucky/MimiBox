//! 弹幕连接生命周期：解析直播间 → 获取弹幕服务器 → wss 连接
//! （认证 + 心跳 + 断线自动重连），并把解析结果以事件广播给前端窗口。

use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use mimibox_plugin::HostApi;
use tokio::time::MissedTickBehavior;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::connect_async;

use super::{DanmakuMessage, DanmakuState, DanmakuStatus, RoomInfo};

/// Chrome 137 UA（与其它 B 站插件保持一致）
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

/// 共享 HTTP 客户端（直播接口请求，凭据显式带 header）
fn http_client() -> &'static reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT.get_or_init(|| reqwest::Client::builder().build().expect("HTTP 客户端初始化失败"))
}

/// 连接指定 B 站账号（mid）的直播间弹幕；若已有连接会先断开。
/// 连接在后台任务里持续重连，状态通过 `danmaku-status` 事件通知。
pub(crate) async fn connect(
    state: &Arc<DanmakuState>,
    host: &Arc<dyn HostApi>,
    mid: &str,
) -> Result<RoomInfo, String> {
    let credentials = host
        .bili_credentials(Some(mid))
        .map_err(|e| format!("获取账号凭据失败: {e}"))?;
    let (uid, cookie) = (credentials.mid, credentials.cookie);
    let room = resolve_room(&cookie, uid).await?;

    state.shutdown();
    let state_for_task = state.clone();
    let host_for_task = host.clone();
    let room_for_task = room.clone();
    state.attach(tokio::spawn(run_connection(
        state_for_task,
        host_for_task,
        cookie,
        room_for_task,
        uid,
    )));
    state.publish_status(
        &**host,
        DanmakuStatus {
            state: "connecting",
            message: None,
            room_id: Some(room.room_id),
            room_title: Some(room.title.clone()),
            viewers: None,
        },
    );
    Ok(room)
}

/// 当前连接任务的句柄（abort 即断开）
pub(crate) struct ConnectionHandle {
    pub(super) task: tokio::task::JoinHandle<()>,
}

/// 连接主循环：断开后 3 秒自动重连（重取 token），直到任务被 abort
async fn run_connection(
    state: Arc<DanmakuState>,
    host: Arc<dyn HostApi>,
    cookie: String,
    room: RoomInfo,
    uid: u64,
) {
    loop {
        if let Err(err) = session(&state, &*host, &cookie, &room, uid).await {
            state.publish_status(
                &*host,
                DanmakuStatus {
                    state: "reconnecting",
                    message: Some(err),
                    room_id: Some(room.room_id),
                    room_title: Some(room.title.clone()),
                    viewers: None,
                },
            );
        }
        tokio::time::sleep(Duration::from_secs(3)).await;
    }
}

/// 一次完整的弹幕会话：取 token → 连接 → 认证 → 心跳 + 收包；
/// 返回 Err 表示连接结束（由外层重连）
async fn session(
    state: &Arc<DanmakuState>,
    host: &dyn HostApi,
    cookie: &str,
    room: &RoomInfo,
    uid: u64,
) -> Result<(), String> {
    state.publish_status(
        host,
        DanmakuStatus {
            state: "connecting",
            message: None,
            room_id: Some(room.room_id),
            room_title: Some(room.title.clone()),
            viewers: None,
        },
    );

    let (token, server) = fetch_danmu_info(cookie, room.room_id).await?;
    let buvid = cookie_value(cookie, "buvid3").unwrap_or_default();

    let url = format!("wss://{}:{}/sub", server.host, server.port);
    let mut request = url
        .clone()
        .into_client_request()
        .map_err(|e| format!("弹幕服务器地址无效: {e}"))?;
    let headers = request.headers_mut();
    headers.insert("User-Agent", HeaderValue::from_static(UA));
    headers.insert("Origin", HeaderValue::from_static("https://live.bilibili.com"));

    let (ws, _) = connect_async(request)
        .await
        .map_err(|e| format!("连接弹幕服务器失败: {e}"))?;
    let (mut sink, mut stream) = ws.split();
    sink.send(Message::Binary(
        super::protocol::auth_packet(room.room_id, uid, &token, &buvid).into(),
    ))
    .await
    .map_err(|e| format!("发送认证包失败: {e}"))?;
    state.publish_status(
        host,
        DanmakuStatus {
            state: "connected",
            message: None,
            room_id: Some(room.room_id),
            room_title: Some(room.title.clone()),
            viewers: None,
        },
    );

    let mut heartbeat = tokio::time::interval(Duration::from_secs(30));
    heartbeat.set_missed_tick_behavior(MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            maybe = stream.next() => {
                match maybe {
                    Some(Ok(Message::Binary(data))) => handle_binary(state, host, &data)?,
                    // tungstenite 不会在 split 模式下自动回 Pong，显式回复保活
                    Some(Ok(Message::Ping(payload))) => {
                        sink.send(Message::Pong(payload))
                            .await
                            .map_err(|e| format!("回复 Ping 失败: {e}"))?;
                    }
                    Some(Ok(Message::Close(frame))) => {
                        let reason = frame
                            .map(|f| f.reason.to_string())
                            .filter(|r| !r.is_empty())
                            .unwrap_or_else(|| "无原因".into());
                        return Err(format!("弹幕服务器关闭了连接（{reason}）"));
                    }
                    Some(Ok(_)) => {}
                    Some(Err(e)) => return Err(format!("弹幕连接中断: {e}")),
                    None => return Err("弹幕连接已断开".into()),
                }
            }
            _ = heartbeat.tick() => {
                sink.send(Message::Binary(super::protocol::heartbeat_packet().into()))
                    .await
                    .map_err(|e| format!("发送心跳失败: {e}"))?;
            }
        }
    }
}

/// 拆包分发：op 3（心跳回复）更新人气值，op 5（消息）解压后逐条解析
fn handle_binary(
    state: &Arc<DanmakuState>,
    host: &dyn HostApi,
    data: &[u8],
) -> Result<(), String> {
    let mut viewers: Option<u64> = None;
    for (protover, op, body) in super::protocol::decode_packets(data) {
        let mut on_json = |raw: &[u8]| handle_message_json(state, host, raw);
        viewers = super::protocol::ingest(protover, op, body, &mut on_json)?.or(viewers);
    }
    if let Some(count) = viewers {
        let mut status = state.status.lock().unwrap().clone();
        status.state = "connected";
        status.message = None;
        status.viewers = Some(count);
        state.publish_status(host, status);
    }
    Ok(())
}

/// 解析一条弹幕 JSON（cmd 以 DANMU_MSG 开头），提取后广播
fn handle_message_json(state: &Arc<DanmakuState>, host: &dyn HostApi, raw: &[u8]) {
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(raw) else {
        return;
    };
    let cmd = value.get("cmd").and_then(|c| c.as_str()).unwrap_or("");
    // 新版协议 cmd 形如 "DANMU_MSG:4:0:2:2:2:0"，只能前缀匹配
    if !cmd.starts_with("DANMU_MSG") {
        return;
    }
    let Some(info) = value.get("info").and_then(|i| i.as_array()) else {
        return;
    };
    let text = info.get(1).and_then(|v| v.as_str()).unwrap_or("").trim();
    if text.is_empty() {
        return;
    }
    // info[2] = [uid, uname, 头像URL, ...]；info[3] = 粉丝牌 [等级, 名称, ...]（无牌为空数组）
    let user = info.get(2).and_then(|v| v.as_array());
    let medal = info
        .get(3)
        .and_then(|v| v.as_array())
        .filter(|m| !m.is_empty());
    let message = DanmakuMessage {
        id: state.seq.fetch_add(1, Ordering::Relaxed) + 1,
        uid: user
            .and_then(|u| u.first())
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        uname: user
            .and_then(|u| u.get(1))
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or("路过的旅人")
            .to_string(),
        avatar: user
            .and_then(|u| u.get(2))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .replace("http://", "https://"),
        text: text.to_string(),
        medal_name: medal
            .and_then(|m| m.get(1))
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_string),
        medal_level: medal
            .and_then(|m| m.first())
            .and_then(|v| v.as_u64())
            .map(|v| v.min(u32::MAX as u64) as u32)
            .filter(|level| *level > 0),
        guard: info.get(7).and_then(|v| v.as_u64()).unwrap_or(0).min(3) as u32,
    };
    state.publish_message(host, message);
}

// ---------------------------------------------------------------------------
// B 站直播 HTTP 接口
// ---------------------------------------------------------------------------

struct DanmuServer {
    host: String,
    port: u16,
}

/// 带凭据请求 B 站直播 JSON 接口，返回校验过 code 的 data 部分
async fn live_api(
    cookie: &str,
    path: &str,
    query: &[(&str, String)],
) -> Result<serde_json::Value, String> {
    let value: serde_json::Value = http_client()
        .get(format!("https://api.live.bilibili.com{path}"))
        .query(query)
        .header(reqwest::header::USER_AGENT, UA)
        .header(reqwest::header::REFERER, "https://live.bilibili.com/")
        .header(reqwest::header::COOKIE, cookie)
        .send()
        .await
        .map_err(|e| format!("请求 B 站直播接口失败: {e}"))?
        .json()
        .await
        .map_err(|e| format!("解析 B 站直播响应失败: {e}"))?;
    if value["code"].as_i64() != Some(0) {
        return Err(format!(
            "{} ({})",
            value["message"].as_str().unwrap_or("未知错误"),
            value["code"].as_i64().unwrap_or(-1)
        ));
    }
    Ok(value["data"].clone())
}

/// 由账号 mid 解析其直播间（未开通直播时报错）
async fn resolve_room(cookie: &str, mid: u64) -> Result<RoomInfo, String> {
    let data = live_api(
        cookie,
        "/room/v1/Room/getRoomInfoOld",
        &[("mid", mid.to_string())],
    )
    .await
    .map_err(|e| format!("解析直播间失败: {e}"))?;
    let room_id = data["roomid"].as_u64().unwrap_or(0);
    if room_id == 0 {
        return Err("该账号还没有开通直播间，请先在 B 站开通直播".into());
    }
    Ok(RoomInfo {
        room_id,
        title: data["title"]
            .as_str()
            .filter(|s| !s.is_empty())
            .unwrap_or("未命名直播间")
            .to_string(),
        live_status: data["liveStatus"].as_i64() == Some(1),
    })
}

/// 获取弹幕服务器列表与认证 token
async fn fetch_danmu_info(cookie: &str, room_id: u64) -> Result<(String, DanmuServer), String> {
    let data = live_api(
        cookie,
        "/xlive/web-room/v1/index/getDanmuInfo",
        &[("id", room_id.to_string()), ("type", "0".into())],
    )
    .await
    .map_err(|e| format!("获取弹幕服务器失败: {e}"))?;
    let token = data["token"]
        .as_str()
        .ok_or_else(|| "弹幕服务器响应缺少 token".to_string())?
        .to_string();
    let host = data["host_list"]
        .as_array()
        .and_then(|list| list.first())
        .ok_or_else(|| "弹幕服务器列表为空".to_string())?;
    Ok((
        token,
        DanmuServer {
            host: host["host"].as_str().unwrap_or_default().to_string(),
            port: host["wss_port"].as_u64().unwrap_or(443) as u16,
        },
    ))
}

/// 从 Cookie 头字符串里取某个键的值
fn cookie_value(cookie: &str, name: &str) -> Option<String> {
    cookie.split(';').find_map(|pair| {
        let (key, value) = pair.trim().split_once('=')?;
        (key.eq_ignore_ascii_case(name)).then(|| value.to_string())
    })
}
