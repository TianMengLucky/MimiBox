//! 账号登录与多账号管理。
//!
//! - Bilibili（[`bilibili`]）：二维码/短信登录（基于 bpi-rs），多账号持久化
//! - 抖音（[`douyin`]）：扫码登录（新安全栈，见 [`crate::douyin_web`]）+ 短信二次验证
//! - 凭据存储（[`store`]）：accounts.json 读写
//! - 头像缓存（[`avatar`]）：B 站/抖音共用的磁盘缓存
//!
//! 头像状态点、账号切换与网页窗口注入等命令从本模块 re-export，
//! Tauri 命令注册路径保持 `account::*` 不变。

mod avatar;
pub(crate) mod bilibili;
pub(crate) mod douyin;
mod douyin_store;
pub(crate) mod manage;
mod store;

use std::path::PathBuf;
use std::sync::Mutex;

use bpi_rs::client::BpiClient;
use tauri::AppHandle;
use reqwest::header::SET_COOKIE;

/// 跨平台账号管理命令（状态/列表/复制 Cookie/退出）
pub use manage::{account_copy_cookie, account_get_status, account_list, account_logout};
/// B 站专属命令（扫码/短信登录、账号切换、网页打开）
pub use bilibili::{
    account_captcha, account_open_web, account_qr_poll, account_qr_start, account_sms_login,
    account_sms_send, account_switch,
};
pub use douyin::{douyin_qr_poll, douyin_qr_sms_send, douyin_qr_sms_validate, douyin_qr_start, douyin_reset_session};
pub use store::{AccountEntry, AccountStatus, CredentialStatus};

pub struct AccountState {
    client: BpiClient,
    http: reqwest::Client,
    pub douyin: Mutex<Option<DouyinSession>>,
    pub douyin_cookies: Mutex<Vec<(String, String)>>,
    /// 新安全栈扫码会话（ttwid/get_qrcode/get_client_cert 握手上下文）
    pub douyin_web: Mutex<Option<crate::douyin_web::DouyinWebSession>>,
    /// 头像磁盘缓存目录（B 站/抖音共用，按 URL 哈希命名）
    avatar_dir: PathBuf,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DouyinSession {
    pub uid: String,
    pub name: Option<String>,
    /// 头像 data URI（profile/self 的 avatar_thumb 下载后缓存）
    pub face: Option<String>,
    pub cookie: String,
}

impl AccountState {
    /// 共享 HTTP 客户端（Cookie 存储 + 重定向），供 B 站内容类功能模块复用
    pub(crate) fn http(&self) -> &reqwest::Client {
        &self.http
    }

    /// 当前活动 B 站账号的 (mid, Cookie 请求头)，未登录返回 None
    pub(crate) fn bilibili_session(&self, app: &AppHandle) -> Result<Option<(u64, String)>, String> {
        let store = store::load_store(app)?;
        Ok(store
            .active_id
            .as_deref()
            .and_then(|id| store.accounts.iter().find(|a| a.dede_user_id == id))
            .map(|a| (a.dede_user_id.parse().unwrap_or(0), cookie_header(a)))
            .filter(|(mid, _)| *mid > 0))
    }

    /// 指定 mid（None 时用活动账号）的 B 站凭据 (mid, Cookie 请求头)；
    /// 供需要按账号（而非仅活动账号）取凭据的功能模块使用
    pub(crate) fn bilibili_credentials(
        &self,
        app: &AppHandle,
        mid: Option<&str>,
    ) -> Result<(u64, String), String> {
        let store = store::load_store(app)?;
        let entry = match mid {
            Some(id) => store
                .accounts
                .iter()
                .find(|a| a.dede_user_id == id)
                .ok_or_else(|| "该账号不存在或已被删除".to_string())?,
            None => store
                .active_id
                .as_deref()
                .and_then(|id| store.accounts.iter().find(|a| a.dede_user_id == id))
                .ok_or_else(|| "请先在账号页登录 B 站账号".to_string())?,
        };
        let mid = entry
            .dede_user_id
            .parse()
            .map_err(|_| "账号 mid 不是有效数字".to_string())?;
        Ok((mid, cookie_header(entry)))
    }
}

/// 由账号记录拼 B 站接口所需的 Cookie 请求头
fn cookie_header(entry: &store::StoredAccount) -> String {
    format!(
        "DedeUserID={}; SESSDATA={}; bili_jct={}; buvid3={}",
        entry.dede_user_id, entry.sessdata, entry.bili_jct, entry.buvid3
    )
}

/// 提取响应的全部 Set-Cookie 为键值对（去掉属性部分）
pub(crate) fn response_cookies(response: &reqwest::Response) -> Vec<(String, String)> {    response
        .headers()
        .get_all(SET_COOKIE)
        .iter()
        .filter_map(|v| {
            let pair = v.to_str().ok()?.split(';').next()?;
            let (k, val) = pair.split_once('=')?;
            Some((k.trim().to_string(), val.trim().to_string()))
        })
        .collect()
}

/// 创建托管的账号状态：恢复本地保存的活动账号
pub fn init_state(app: &AppHandle) -> Result<AccountState, Box<dyn std::error::Error>> {
    let client = BpiClient::new()?;
    let store = store::load_store(app).unwrap_or_default();
    if let Some(active) = store
        .active_id
        .as_ref()
        .and_then(|id| store.accounts.iter().find(|a| &a.dede_user_id == id))
    {
        client
            .set_account(active.to_account())
            .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
    }

    // HTTP 客户端（启用 Cookie 存储 + 重定向限制）
    // 注意：reqwest 不支持 TLS 指纹模拟，抖音/B站登录可能因 TLS 指纹被风控拦截
    let http = reqwest::Client::builder()
        .cookie_store(true)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()?;

    // 恢复抖音登录态与设备 cookie（douyin_state.json）：重启后免重新扫码，
    // 且设备级 cookie（ttwid 等）跨登录延续，避免重复触发短信二次验证
    let persist = douyin_store::load(app);
    let douyin_session = persist
        .session
        .filter(|session| !session.cookie.is_empty());

    // 头像磁盘缓存目录（accounts.json 同级的 avatars/）
    let avatar_dir = store::data_dir(app)?.join("avatars");
    if !avatar_dir.exists() {
        std::fs::create_dir_all(&avatar_dir).map_err(|e| format!("无法创建头像缓存目录: {e}"))?;
    }

    Ok(AccountState {
        client,
        http,
        douyin: Mutex::new(douyin_session),
        douyin_cookies: Mutex::new(persist.cookies),
        douyin_web: Mutex::new(None),
        avatar_dir,
    })
}
