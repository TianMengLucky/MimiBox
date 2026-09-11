//! 抖音登录态持久化（douyin_state.json）。
//!
//! 保存完整 cookie jar 与 DouyinSession，实现两个目的：
//! 1. 应用重启后恢复抖音登录态（无需重新扫码）；
//! 2. 设备级 cookie（ttwid/passport_csrf_token 等）跨登录延续——抖音 passport
//!    据此识别"已验证设备"，解决"登录过一次后再次登录仍触发短信二次验证"。
//!
//! 文件位于应用数据目录 `douyin_state.json`；解析失败降级为空数据，
//! 不影响应用启动。登录票据类 cookie（sessionid/sid_tt 等）仅在
//! 刷新二维码/退出登录时剥离，设备 cookie 保留。

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::store::data_dir;
use super::DouyinSession;

/// 登录票据类 cookie：刷新二维码/退出登录时从 jar 中剥离，
/// 避免旧会话干扰下一次扫码登录；设备级 cookie（ttwid 等）不在列表内
const SESSION_COOKIE_NAMES: &[&str] = &[
    "sessionid",
    "sessionid_ss",
    "sessionid_ln",
    "sid_tt",
    "sid_tt_ln",
    "sid_guard",
    "uid_tt",
    "uid_tt_ss",
    "sid_ucp_v1",
    "sid_ucp_v1_ss",
    "sid_hk",
    "sid_hk_ss",
    "sso_uid_tt",
    "sso_uid_tt_ss",
    "passport_auth_status",
    "passport_auth_status_ss",
];

/// 从 cookie jar 中剥离登录票据 cookie（保留设备级 cookie）
pub(super) fn strip_session_cookies(cookies: &mut Vec<(String, String)>) {
    cookies.retain(|(k, _)| {
        !SESSION_COOKIE_NAMES
            .iter()
            .any(|name| k.eq_ignore_ascii_case(name))
    });
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(super) struct DouyinPersist {
    #[serde(default)]
    pub(super) cookies: Vec<(String, String)>,
    #[serde(default)]
    pub(super) session: Option<DouyinSession>,
}

fn persist_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(data_dir(app)?.join("douyin_state.json"))
}

/// 读取持久化状态；文件不存在或解析失败时返回空数据（不崩溃）
pub(super) fn load(app: &AppHandle) -> DouyinPersist {
    let Ok(path) = persist_path(app) else {
        return DouyinPersist::default();
    };
    let Ok(text) = std::fs::read_to_string(&path) else {
        return DouyinPersist::default();
    };
    match serde_json::from_str(&text) {
        Ok(persist) => persist,
        Err(e) => {
            eprintln!("[douyin] douyin_state.json 解析失败，降级为空数据: {e}");
            DouyinPersist::default()
        }
    }
}

/// 写入持久化状态；写失败仅记录日志（登录态丢失可重新扫码恢复）
pub(super) fn save(app: &AppHandle, persist: &DouyinPersist) {
    let Err(e) = (|| -> Result<(), String> {
        let path = persist_path(app)?;
        let text =
            serde_json::to_string_pretty(persist).map_err(|e| format!("序列化失败: {e}"))?;
        std::fs::write(path, text).map_err(|e| format!("写入失败: {e}"))
    })() else {
        return;
    };
    eprintln!("[douyin] 登录态持久化失败: {e}");
}

/// 清除持久化的会话部分（保留 cookie jar，维持设备信任）
pub(super) fn clear_session(app: &AppHandle) {
    let mut persist = load(app);
    if persist.session.is_none() {
        return;
    }
    persist.session = None;
    save(app, &persist);
}
