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
use wreq::header::SET_COOKIE;

/// 跨平台账号管理命令（状态/列表/复制 Cookie/退出）
pub use manage::{account_copy_cookie, account_get_status, account_list, account_logout};
/// B 站专属命令（扫码/短信登录、账号切换/移除、网页打开）
pub use bilibili::{
    account_captcha, account_open_web, account_qr_poll, account_qr_start, account_remove,
    account_sms_login, account_sms_send, account_switch,
};
pub use douyin::{douyin_qr_poll, douyin_qr_sms_send, douyin_qr_sms_validate, douyin_qr_start, douyin_reset_session};
pub use store::{AccountEntry, AccountStatus, CredentialStatus};

pub struct AccountState {
    client: BpiClient,
    http: wreq::Client,
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

/// 提取响应的全部 Set-Cookie 为键值对（去掉属性部分）
pub(crate) fn response_cookies(response: &wreq::Response) -> Vec<(String, String)> {
    response
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

    // HTTP 客户端（启用 Cookie 存储）
    // 使用 wreq 模拟 Chrome 136 (Windows) 的 TLS(JA3/JA4) 与 HTTP/2 指纹，
    // 降低抖音风控对“非浏览器客户端”的识别（error_code 7 频控）。
    // skip_headers(true)：传输层指纹交给 emulation，HTTP 头仍由现有代码手动
    // 控制（UA 已是 Chrome/136 Windows，与指纹一致），保证 A/B 验证唯一变量是传输层。
    let http = wreq::Client::builder()
        .cookie_store(true)
        .redirect(wreq::redirect::Policy::limited(10))
        .emulation(
            wreq_util::EmulationOption::builder()
                .emulation(wreq_util::Emulation::Chrome137)
                .emulation_os(wreq_util::EmulationOS::Windows)
                .skip_headers(true)
                .build(),
        )
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
