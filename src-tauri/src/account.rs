//! 账号登录（基于 bpi-rs 的 Bilibili 客户端），支持多账号管理
//!
//! - 二维码登录：Rust 端用 bpi-rs 获取登录 URL，再用 `qrcode` 渲染为 PNG，
//!   以 data URL 交给前端展示；轮询状态由前端定时调用 `account_qr_poll`。
//! - 多账号：登录成功后的 Cookie 凭据统一保存在应用数据目录 accounts.json
//!   （账号列表 + 当前活动账号），启动时自动恢复活动账号。

use std::io::Cursor;
use std::path::PathBuf;
use std::sync::Mutex;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use bpi_rs::client::BpiClient;
use bpi_rs::login::params::LoginQrPollParams;
use bpi_rs::session::Account;
use serde::{Deserialize, Serialize};
use tauri::webview::Cookie;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

/// 二维码轮询状态码（bilibili-API-collect）
const QR_CODE_SUCCESS: i32 = 0;
const QR_CODE_EXPIRED: i32 = 86038;
const QR_CODE_SCANNED: i32 = 86090;
const QR_CODE_WAITING: i32 = 86101;

pub struct AccountState {
    client: BpiClient,
    http: wreq::Client,
    pub douyin: Mutex<Option<DouyinSession>>,
    pub douyin_cookies: Mutex<Vec<(String, String)>>,
    /// 新安全栈扫码会话（ttwid/get_qrcode/get_client_cert 握手上下文）
    pub douyin_web: Mutex<Option<crate::douyin_web::DouyinWebSession>>,
}

#[derive(Clone)]
pub struct DouyinSession {
    pub uid: String,
    pub name: Option<String>,
    pub cookie: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DouyinQrStart { pub qr_image: String }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DouyinQrPoll {
    pub status: String,
    pub message: String,
    pub uid: Option<String>,
    pub name: Option<String>,
    /// 过期无感换码：内嵌新二维码的 data URI
    pub new_qr_image: Option<String>,
    /// 扫码二次验证：需要短信验证码时携带脱敏手机号（可能为 None）
    pub mobile: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DouyinQrSmsSend {
    pub mobile: Option<String>,
}

const PASSPORT: &str = "https://passport.bilibili.com";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptchaInfo {
    pub token: String,
    pub gt: String,
    pub challenge: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmsSendResult {
    pub captcha_key: String,
}

#[derive(Deserialize)]
struct ApiResponse {
    code: i64,
    message: String,
    data: Option<serde_json::Value>,
}

fn api_error(response: &ApiResponse) -> Result<(), String> {
    if response.code == 0 {
        Ok(())
    } else {
        Err(format!("{} ({})", response.message, response.code))
    }
}

pub(crate) fn response_cookies(response: &wreq::Response) -> Vec<(String, String)> {
    response
        .headers()
        .get_all(wreq::header::SET_COOKIE)
        .iter()
        .filter_map(|v| {
            let pair = v.to_str().ok()?.split(';').next()?;
            let (k, val) = pair.split_once('=')?;
            Some((k.trim().to_string(), val.trim().to_string()))
        })
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountStatus {
    logged_in: bool,
    mid: Option<u64>,
    uname: Option<String>,
    face: Option<String>,
}

impl AccountStatus {
    fn not_logged_in() -> Self {
        Self {
            logged_in: false,
            mid: None,
            uname: None,
            face: None,
        }
    }

    /// 网络异常时的兜底状态：凭据已生效，仅缺少资料
    fn offline(account: &Account, uname: Option<String>, face: Option<String>) -> Self {
        Self {
            logged_in: true,
            mid: account.dede_user_id.parse().ok(),
            uname,
            face,
        }
    }
}

/// 保存到 accounts.json 的单条账号记录（含缓存的昵称/头像）
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StoredAccount {
    dede_user_id: String,
    sessdata: String,
    bili_jct: String,
    buvid3: String,
    #[serde(default)]
    uname: Option<String>,
    #[serde(default)]
    face: Option<String>,
}

impl StoredAccount {
    fn from_account(account: &Account, uname: Option<String>, face: Option<String>) -> Self {
        Self {
            dede_user_id: account.dede_user_id.clone(),
            sessdata: account.sessdata.clone(),
            bili_jct: account.bili_jct.clone(),
            buvid3: account.buvid3.clone(),
            uname,
            face,
        }
    }

    fn to_account(&self) -> Account {
        Account::new(
            self.dede_user_id.clone(),
            self.sessdata.clone(),
            self.bili_jct.clone(),
            self.buvid3.clone(),
        )
    }
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AccountStore {
    active_id: Option<String>,
    accounts: Vec<StoredAccount>,
}

/// 交给前端的账号条目（不含任何凭据）
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountEntry {
    pub dede_user_id: String,
    pub platform: String,
    pub uname: Option<String>,
    pub face: Option<String>,
    pub active: bool,
    pub credential_status: CredentialStatus,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CredentialStatus {
    Valid,
    Expired,
    Unknown,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QrStart {
    /// PNG 二维码图片（data URL，Rust 端渲染）
    qr_image: String,
    qrcode_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QrPoll {
    /// waiting: 未扫码 / scanned: 已扫码待确认 / success: 已登录 / expired: 已过期
    status: &'static str,
    message: String,
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法解析应用数据目录: {e}"))?;
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("无法创建数据目录 {}: {e}", dir.display()))?;
    }
    Ok(dir)
}

fn accounts_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("accounts.json"))
}

fn save_store(app: &AppHandle, store: &AccountStore) -> Result<(), String> {
    let path = accounts_path(app)?;
    let text =
        serde_json::to_string_pretty(store).map_err(|e| format!("序列化账号列表失败: {e}"))?;
    std::fs::write(path, text).map_err(|e| format!("无法保存账号列表: {e}"))
}

/// 读取账号列表；文件不存在（首次运行）时返回空列表
fn load_store(app: &AppHandle) -> Result<AccountStore, String> {
    let path = accounts_path(app)?;
    if !path.exists() {
        return Ok(AccountStore::default());
    }
    let text = std::fs::read_to_string(&path).map_err(|e| format!("无法读取账号列表: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("账号列表解析失败: {e}"))
}

/// 登录成功或资料更新时写入/更新账号记录并设为活动账号
fn persist_account(
    app: &AppHandle,
    account: &Account,
    status: &AccountStatus,
) -> Result<(), String> {
    let mut store = load_store(app)?;
    let uname = status.uname.clone();
    let face = status.face.clone();
    if let Some(existing) = store
        .accounts
        .iter_mut()
        .find(|a| a.dede_user_id == account.dede_user_id)
    {
        existing.sessdata = account.sessdata.clone();
        existing.bili_jct = account.bili_jct.clone();
        existing.buvid3 = account.buvid3.clone();
        if uname.is_some() {
            existing.uname = uname;
        }
        if face.is_some() {
            existing.face = face;
        }
    } else {
        store
            .accounts
            .push(StoredAccount::from_account(account, uname, face));
    }
    store.active_id = Some(account.dede_user_id.clone());
    save_store(app, &store)
}

/// 从 Cookie 键值对中提取登录凭据，缺失关键 Cookie 时返回错误
async fn account_from_cookies(
    client: &BpiClient,
    pairs: &[(String, String)],
) -> Result<Account, String> {
    let take = |name: &str| {
        pairs
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.clone())
            .ok_or_else(|| format!("登录响应缺少 Cookie: {name}"))
    };
    let buvid3 = pairs
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("buvid3"))
        .map(|(_, v)| v.clone())
        .filter(|value| !value.is_empty());
    let buvid3 = match buvid3 {
        Some(value) => value,
        None => {
            client
                .misc()
                .buvid3()
                .await
                .map_err(|e| format!("获取设备标识失败: {e}"))?
                .buvid
        }
    };

    Ok(Account::new(
        take("DedeUserID")?,
        take("SESSDATA")?,
        take("bili_jct")?,
        buvid3,
    ))
}

/// 应用登录凭据：写入客户端、拉取资料并持久化到多账号列表
async fn apply_account(
    app: &AppHandle,
    state: &AccountState,
    cookies: &[(String, String)],
) -> Result<AccountStatus, String> {
    let account = account_from_cookies(&state.client, cookies).await?;
    state
        .client
        .set_account(account.clone())
        .map_err(|e| format!("应用登录凭据失败: {e}"))?;
    let status = status_from_nav(state)
        .await
        .unwrap_or_else(|_| AccountStatus::offline(&account, None, None));
    persist_account(app, &account, &status)?;
    Ok(status)
}

/// 在 Rust 端将文本渲染为 PNG 二维码（base64 data URL）
fn render_qr_png(text: &str) -> Result<String, String> {
    let code = qrcode::QrCode::with_error_correction_level(text.as_bytes(), qrcode::EcLevel::M)
        .map_err(|e| format!("二维码编码失败: {e}"))?;
    let matrix = code
        .render::<image::Luma<u8>>()
        .min_dimensions(280, 280)
        .quiet_zone(true)
        .build();
    let mut png = Vec::new();
    image::DynamicImage::ImageLuma8(matrix)
        .write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
        .map_err(|e| format!("二维码渲染失败: {e}"))?;
    Ok(format!("data:image/png;base64,{}", BASE64.encode(&png)))
}

async fn status_from_client(
    client: &BpiClient,
    http: &wreq::Client,
) -> Result<AccountStatus, String> {
    let nav = client
        .login()
        .nav()
        .await
        .map_err(|e| format!("获取登录状态失败: {e}"))?;
    let face = match nav.face {
        Some(url) => fetch_face_data_url(http, &url).await.or(Some(url)),
        None => None,
    };
    Ok(AccountStatus {
        logged_in: nav.is_login,
        mid: nav.mid.map(|m| m.get()),
        uname: nav.uname,
        face,
    })
}

async fn status_from_nav(state: &AccountState) -> Result<AccountStatus, String> {
    status_from_client(&state.client, &state.http).await
}

async fn fetch_face_data_url(client: &wreq::Client, url: &str) -> Option<String> {
    let url = url.replace("http://", "https://");
    let response = client
        .get(url)
        .header(wreq::header::REFERER, "https://www.bilibili.com/")
        .header(wreq::header::USER_AGENT, "Mozilla/5.0")
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let content_type = response
        .headers()
        .get(wreq::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .filter(|value| value.starts_with("image/"))
        .unwrap_or("image/jpeg")
        .to_string();
    let bytes = response.bytes().await.ok()?;
    Some(format!(
        "data:{content_type};base64,{}",
        BASE64.encode(bytes)
    ))
}

#[tauri::command]
pub async fn account_get_status(
    app: AppHandle,
    state: State<'_, AccountState>,
) -> Result<AccountStatus, String> {
    if let Some(session) = state
        .douyin
        .lock()
        .map_err(|_| "抖音会话锁定失败")?
        .clone()
    {
        return Ok(AccountStatus {
            logged_in: true,
            mid: session.uid.parse().ok(),
            uname: session.name,
            face: None,
        });
    }
    if load_store(&app)?.active_id.is_none() {
        return Ok(AccountStatus::not_logged_in());
    }
    status_from_nav(&state).await
}

/// 刷新并列出已保存账号的凭据状态（不向前端暴露凭据）
#[tauri::command]
pub async fn account_list(
    app: AppHandle,
    state: State<'_, AccountState>,
) -> Result<Vec<AccountEntry>, String> {
    let mut store = load_store(&app)?;
    let active_id = store.active_id.clone();
    let mut entries = Vec::with_capacity(store.accounts.len());

    for account in &mut store.accounts {
        let client = match BpiClient::new() {
            Ok(client) => client,
            Err(_) => {
                entries.push(AccountEntry {
                    dede_user_id: account.dede_user_id.clone(),
                    platform: "bilibili".into(),
                    uname: account.uname.clone(),
                    face: account.face.clone(),
                    active: active_id.as_deref() == Some(account.dede_user_id.as_str()),
                    credential_status: CredentialStatus::Unknown,
                });
                continue;
            }
        };

        let credential_status = if client.set_account(account.to_account()).is_err() {
            CredentialStatus::Expired
        } else {
            match status_from_client(&client, &state.http).await {
                Ok(status) if status.logged_in => {
                    if status.uname.is_some() {
                        account.uname = status.uname;
                    }
                    if status.face.is_some() {
                        account.face = status.face;
                    }
                    CredentialStatus::Valid
                }
                Ok(_) => CredentialStatus::Expired,
                Err(_) => CredentialStatus::Unknown,
            }
        };

        entries.push(AccountEntry {
            dede_user_id: account.dede_user_id.clone(),
            platform: "bilibili".into(),
            uname: account.uname.clone(),
            face: account.face.clone(),
            active: active_id.as_deref() == Some(account.dede_user_id.as_str()),
            credential_status,
        });
    }

    save_store(&app, &store)?;
    if let Some(session) = state.douyin.lock().map_err(|_| "抖音会话锁定失败")?.clone() {
        entries.push(AccountEntry {
            dede_user_id: session.uid,
            platform: "douyin".into(),
            uname: session.name,
            face: None,
            active: true,
            credential_status: CredentialStatus::Valid,
        });
    }
    Ok(entries)
}

/// 切换当前活动账号（凭据从本地列表恢复，无需重新登录）
#[tauri::command]
pub async fn account_switch(
    app: AppHandle,
    state: State<'_, AccountState>,
    mid: String,
) -> Result<AccountStatus, String> {
    let mut store = load_store(&app)?;
    let entry = store
        .accounts
        .iter()
        .find(|a| a.dede_user_id == mid)
        .cloned()
        .ok_or_else(|| "该账号未保存".to_string())?;
    let account = entry.to_account();
    state
        .client
        .set_account(account.clone())
        .map_err(|e| format!("应用登录凭据失败: {e}"))?;
    store.active_id = Some(mid);
    let status = status_from_nav(&state)
        .await
        .unwrap_or_else(|_| AccountStatus::offline(&account, entry.uname, entry.face));
    if let Some(existing) = store
        .accounts
        .iter_mut()
        .find(|a| a.dede_user_id == account.dede_user_id)
    {
        if status.uname.is_some() {
            existing.uname = status.uname.clone();
        }
        if status.face.is_some() {
            existing.face = status.face.clone();
        }
    }
    save_store(&app, &store)?;
    Ok(status)
}

/// 从列表中移除一个账号；移除的是当前活动账号时同时注销会话
#[tauri::command]
pub async fn account_remove(
    app: AppHandle,
    state: State<'_, AccountState>,
    mid: String,
) -> Result<(), String> {
    let mut store = load_store(&app)?;
    let before = store.accounts.len();
    store.accounts.retain(|a| a.dede_user_id != mid);
    if store.accounts.len() == before {
        return Err("该账号未保存".into());
    }
    if store.active_id.as_deref() == Some(mid.as_str()) {
        store.active_id = None;
        state.client.clear_account();
    }
    save_store(&app, &store)
}

/// 在隔离的网页窗口中打开 Bilibili，并注入当前账号的登录 Cookie。
#[tauri::command]
pub async fn account_open_web(
    app: AppHandle,
    state: State<'_, AccountState>,
) -> Result<(), String> {
    let status = status_from_nav(&state).await?;
    if !status.logged_in {
        return Err("当前账号登录凭证已过期，请重新登录".into());
    }

    let store = load_store(&app)?;
    let active_id = store
        .active_id
        .as_deref()
        .ok_or_else(|| "当前没有已登录账号".to_string())?;
    let account = store
        .accounts
        .iter()
        .find(|account| account.dede_user_id == active_id)
        .ok_or_else(|| "当前账号未保存在账号列表中".to_string())?;

    let label = format!("bilibili-{}", account.dede_user_id);
    let bilibili_url: tauri::Url = "https://www.bilibili.com/"
        .parse()
        .map_err(|e| format!("Bilibili 地址无效: {e}"))?;
    let cookie_script = [
        ("DedeUserID", account.dede_user_id.as_str()),
        ("SESSDATA", account.sessdata.as_str()),
        ("bili_jct", account.bili_jct.as_str()),
        ("buvid3", account.buvid3.as_str()),
    ]
    .into_iter()
    .map(|(name, value)| {
        let cookie = format!("{name}={value}; Domain=.bilibili.com; Path=/; Secure; SameSite=None");
        serde_json::to_string(&cookie)
            .map(|cookie| format!("document.cookie = {cookie};"))
            .map_err(|e| format!("无法准备网页登录凭证: {e}"))
    })
    .collect::<Result<String, String>>()?;

    let webview = if let Some(existing) = app.get_webview_window(&label) {
        existing
            .eval(&cookie_script)
            .map_err(|e| format!("无法更新网页登录凭证: {e}"))?;
        existing
    } else {
        let profile_dir = data_dir(&app)?
            .join("webview-profiles")
            .join(&account.dede_user_id);
        WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(bilibili_url.clone()))
            .title("哔哩哔哩")
            .inner_size(1200.0, 800.0)
            .min_inner_size(720.0, 480.0)
            .data_directory(profile_dir)
            .initialization_script(cookie_script)
            .visible(false)
            .build()
            .map_err(|e| format!("无法创建网页窗口: {e}"))?
    };

    for (name, value, http_only) in [
        ("DedeUserID", account.dede_user_id.as_str(), false),
        ("SESSDATA", account.sessdata.as_str(), true),
        ("bili_jct", account.bili_jct.as_str(), false),
        ("buvid3", account.buvid3.as_str(), false),
    ] {
        let cookie = Cookie::build((name, value))
            .domain(".bilibili.com")
            .path("/")
            .secure(true)
            .http_only(http_only)
            .build();
        webview
            .set_cookie(cookie)
            .map_err(|e| format!("无法设置网页登录凭证: {e}"))?;
    }

    webview
        .navigate(bilibili_url)
        .map_err(|e| format!("无法打开 Bilibili 网页: {e}"))?;
    webview
        .show()
        .and_then(|_| webview.set_focus())
        .map_err(|e| format!("无法显示 Bilibili 网页窗口: {e}"))
}

#[tauri::command]
pub async fn account_qr_start(state: State<'_, AccountState>) -> Result<QrStart, String> {
    let generated = state
        .client
        .login()
        .qr_generate()
        .await
        .map_err(|e| format!("获取登录二维码失败: {e}"))?;
    let qr_image = render_qr_png(&generated.url)?;
    Ok(QrStart {
        qr_image,
        qrcode_key: generated.qrcode_key,
    })
}

#[tauri::command]
pub async fn account_qr_poll(
    app: AppHandle,
    state: State<'_, AccountState>,
    qrcode_key: String,
) -> Result<QrPoll, String> {
    let params = LoginQrPollParams::new(qrcode_key).map_err(|e| e.to_string())?;
    let data = state
        .client
        .login()
        .qr_poll(params)
        .await
        .map_err(|e| format!("轮询扫码状态失败: {e}"))?;

    match data.code {
        QR_CODE_SUCCESS => {
            apply_account(&app, &state, &data.cookies).await?;
            Ok(QrPoll {
                status: "success",
                message: "登录成功".into(),
            })
        }
        QR_CODE_EXPIRED => Ok(QrPoll {
            status: "expired",
            message: "二维码已过期，请刷新".into(),
        }),
        QR_CODE_SCANNED => Ok(QrPoll {
            status: "scanned",
            message: "已扫码，请在手机上确认登录".into(),
        }),
        QR_CODE_WAITING => Ok(QrPoll {
            status: "waiting",
            message: "等待扫码".into(),
        }),
        other => Ok(QrPoll {
            status: "expired",
            message: format!("未知状态码 {other}，请刷新重试"),
        }),
    }
}

#[tauri::command]
pub async fn account_captcha(state: State<'_, AccountState>) -> Result<CaptchaInfo, String> {
    let response: ApiResponse = state
        .http
        .get(format!(
            "{PASSPORT}/x/passport-login/captcha?source=main_web"
        ))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    api_error(&response)?;
    let data = response.data.ok_or("验证码响应缺少 data")?;
    Ok(CaptchaInfo {
        token: data["token"].as_str().ok_or("验证码响应缺少 token")?.into(),
        gt: data["geetest"]["gt"]
            .as_str()
            .ok_or("验证码响应缺少 gt")?
            .into(),
        challenge: data["geetest"]["challenge"]
            .as_str()
            .ok_or("验证码响应缺少 challenge")?
            .into(),
    })
}

#[tauri::command]
pub async fn account_sms_send(
    state: State<'_, AccountState>,
    tel: String,
    token: String,
    challenge: String,
    validate: String,
    seccode: String,
) -> Result<SmsSendResult, String> {
    if tel.trim().is_empty() || validate.trim().is_empty() || seccode.trim().is_empty() {
        return Err("请填写手机号和人机验证结果".into());
    }
    let response: ApiResponse = state
        .http
        .post(format!("{PASSPORT}/x/passport-login/web/sms/send"))
        .form(&[
            ("cid", "1"),
            ("tel", tel.trim()),
            ("source", "main_web"),
            ("token", token.as_str()),
            ("challenge", challenge.as_str()),
            ("validate", validate.as_str()),
            ("seccode", seccode.as_str()),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    api_error(&response)?;
    let key = response.data.ok_or("短信响应缺少 data")?["captcha_key"]
        .as_str()
        .ok_or("短信响应缺少 captcha_key")?
        .to_string();
    Ok(SmsSendResult { captcha_key: key })
}

#[tauri::command]
pub async fn account_sms_login(
    app: AppHandle,
    state: State<'_, AccountState>,
    tel: String,
    code: String,
    captcha_key: String,
) -> Result<AccountStatus, String> {
    let response = state
        .http
        .post(format!("{PASSPORT}/x/passport-login/web/login/sms"))
        .form(&[
            ("cid", "1"),
            ("tel", tel.trim()),
            ("code", code.trim()),
            ("source", "main_web"),
            ("captcha_key", captcha_key.as_str()),
            ("keep", "true"),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let cookies = response_cookies(&response);
    let body: ApiResponse = response.json().await.map_err(|e| e.to_string())?;
    api_error(&body)?;
    apply_account(&app, &state, &cookies).await
}

fn chrono_like_now() -> u128 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or_default()
}

/// 重置抖音 web 会话：清空 cookie 与扫码会话上下文（模拟用户刷新页面；
/// 新安全栈 ttwid/get_qrcode/握手上下文全部重建）
#[tauri::command]
pub async fn douyin_reset_session(state: State<'_, AccountState>) -> Result<(), String> {
    {
        let mut cookies = state.douyin_cookies.lock().map_err(|_| "Cookie锁定失败")?;
        cookies.clear();
    }
    *state.douyin_web.lock().map_err(|_| "会话锁失败")? = None;
    Ok(())
}

#[tauri::command]
pub async fn douyin_qr_start(state: State<'_, AccountState>) -> Result<DouyinQrStart, String> {
    // 完整链路：ttwid（aid=10006 回调）→ get_qrcode（bdms a_bogus + X-Ms-Token）
    // → get_client_cert 握手 → DTrait d1 安全头（约 4 秒）
    let (qr_image, session) =
        crate::douyin_web::start(&state.http, &state.douyin_cookies).await?;
    *state.douyin_web.lock().map_err(|_| "会话锁失败")? = Some(session);
    Ok(DouyinQrStart { qr_image })
}

#[tauri::command]
pub async fn douyin_qr_poll(state: State<'_, AccountState>) -> Result<DouyinQrPoll, String> {
    // 会话上下文（安全头/msToken/token）全部保存在服务端会话中，前端无需传参
    let outcome = {
        // 不能跨 await 持有 std::MutexGuard（!Send），先把会话 take 出来
        let mut session = state
            .douyin_web
            .lock()
            .map_err(|_| "会话锁失败")?
            .take()
            .ok_or_else(|| "扫码会话不存在，请刷新二维码".to_string())?;
        let result = crate::douyin_web::poll(&state.http, &state.douyin_cookies, &mut session).await;
        // 非 confirmed 结果都要把会话放回去（confirmed 分支会置 None）
        let is_confirmed =
            matches!(result, Ok(crate::douyin_web::PollOutcome::Confirmed { .. }));
        if !is_confirmed {
            *state.douyin_web.lock().map_err(|_| "会话锁失败")? = Some(session);
        }
        result?
    };

    use crate::douyin_web::PollOutcome;
    match outcome {
        PollOutcome::Waiting => Ok(DouyinQrPoll {
            status: "waiting".into(),
            message: "等待扫码".into(),
            uid: None,
            name: None,
            new_qr_image: None,
            mobile: None,
        }),
        PollOutcome::Scanned => Ok(DouyinQrPoll {
            status: "scanned".into(),
            message: "已扫码，请在手机上确认登录".into(),
            uid: None,
            name: None,
            new_qr_image: None,
            mobile: None,
        }),
        PollOutcome::RateLimited => Ok(DouyinQrPoll {
            status: "waiting".into(),
            message: "请求过于频繁，正在退避重试…".into(),
            uid: None,
            name: None,
            new_qr_image: None,
            mobile: None,
        }),
        PollOutcome::Refreshed { qr_data_uri } => Ok(DouyinQrPoll {
            status: "expired".into(),
            message: "二维码已刷新，请重新扫码".into(),
            uid: None,
            name: None,
            new_qr_image: Some(qr_data_uri),
            mobile: None,
        }),
        PollOutcome::Expired => Ok(DouyinQrPoll {
            status: "expired".into(),
            message: "二维码已过期，请刷新".into(),
            uid: None,
            name: None,
            new_qr_image: None,
            mobile: None,
        }),
        PollOutcome::VerificationRequired { mobile } => Ok(DouyinQrPoll {
            status: "verification_required".into(),
            message: "账号需要短信二次验证，验证码已发送".into(),
            uid: None,
            name: None,
            new_qr_image: None,
            mobile,
        }),
        PollOutcome::VerificationUnsupported { message } => Ok(DouyinQrPoll {
            status: "verification_unsupported".into(),
            message,
            uid: None,
            name: None,
            new_qr_image: None,
            mobile: None,
        }),
        PollOutcome::Confirmed { uid, name, cookie } => {
            let uid_value = uid.unwrap_or_else(|| format!("douyin-{}", chrono_like_now()));
            *state.douyin.lock().map_err(|_| "抖音会话锁定失败")? =
                Some(DouyinSession { uid: uid_value.clone(), name: name.clone(), cookie });
            *state.douyin_web.lock().map_err(|_| "会话锁失败")? = None;
            Ok(DouyinQrPoll {
                status: "success".into(),
                message: "登录成功".into(),
                uid: Some(uid_value),
                name,
                new_qr_image: None,
                mobile: None,
            })
        }
    }
}

/// 扫码二次验证：重新发送短信验证码（首次验证码在触发 2046 时已自动发送）
#[tauri::command]
pub async fn douyin_qr_sms_send(state: State<'_, AccountState>) -> Result<DouyinQrSmsSend, String> {
    let mut session = state
        .douyin_web
        .lock()
        .map_err(|_| "会话锁失败")?
        .take()
        .ok_or_else(|| "扫码会话不存在，请刷新二维码".to_string())?;
    // 无论成败都把会话放回去（失败时前端可重发）
    let result = crate::douyin_web::mfa_send(&state.http, &state.douyin_cookies, &mut session).await;
    *state.douyin_web.lock().map_err(|_| "会话锁失败")? = Some(session);
    Ok(DouyinQrSmsSend { mobile: result? })
}

/// 扫码二次验证：校验短信验证码；成功后后续轮询自动携带 verify_ticket 完成登录
#[tauri::command]
pub async fn douyin_qr_sms_validate(state: State<'_, AccountState>, code: String) -> Result<(), String> {
    let mut session = state
        .douyin_web
        .lock()
        .map_err(|_| "会话锁失败")?
        .take()
        .ok_or_else(|| "扫码会话不存在，请刷新二维码".to_string())?;
    let result = crate::douyin_web::mfa_validate(&state.http, &state.douyin_cookies, &mut session, &code).await;
    // 验证失败也放回会话，允许用户重新输入/重发；成功同样放回（继续 check 轮询）
    *state.douyin_web.lock().map_err(|_| "会话锁失败")? = Some(session);
    result
}

/// 退出当前活动账号：从列表中移除并清除会话（其他保存的账号不受影响）
#[tauri::command]
pub async fn account_logout(app: AppHandle, state: State<'_, AccountState>) -> Result<(), String> {
    *state.douyin.lock().map_err(|_| "抖音会话锁定失败")? = None;
    let mut store = load_store(&app)?;
    if let Some(active) = store.active_id.clone() {
        store.accounts.retain(|a| a.dede_user_id != active);
        store.active_id = None;
        save_store(&app, &store)?;
    }
    state.client.clear_account();
    Ok(())
}

/// 创建托管的账号状态：恢复本地保存的活动账号
pub fn init_state(app: &AppHandle) -> Result<AccountState, Box<dyn std::error::Error>> {
    let client = BpiClient::new()?;
    let store = load_store(app).unwrap_or_default();
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
                .emulation(wreq_util::Emulation::Chrome136)
                .emulation_os(wreq_util::EmulationOS::Windows)
                .skip_headers(true)
                .build(),
        )
        .build()?;

    Ok(AccountState {
        client,
        http,
        douyin: Mutex::new(None),
        douyin_cookies: Mutex::new(Vec::new()),
        douyin_web: Mutex::new(None),
    })
}
