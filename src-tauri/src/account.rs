//! 账号登录（基于 bpi-rs 的 Bilibili 客户端）
//!
//! - 二维码登录：Rust 端用 bpi-rs 获取登录 URL，再用 `qrcode` 渲染为 PNG，
//!   以 data URL 交给前端展示；轮询状态由前端定时调用 `account_qr_poll`。
//! - 登录成功后的 Cookie 凭据保存在应用数据目录 account.json，启动时自动恢复。

use std::io::Cursor;
use std::path::PathBuf;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use bpi_rs::client::BpiClient;
use bpi_rs::login::params::LoginQrPollParams;
use bpi_rs::session::Account;
use rand::rngs::OsRng;
use rsa::pkcs8::DecodePublicKey;
use rsa::{Pkcs1v15Encrypt, RsaPublicKey};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

/// 二维码轮询状态码（bilibili-API-collect）
const QR_CODE_SUCCESS: i32 = 0;
const QR_CODE_EXPIRED: i32 = 86038;
const QR_CODE_SCANNED: i32 = 86090;
const QR_CODE_WAITING: i32 = 86101;

pub struct AccountState {
    client: BpiClient,
    http: reqwest::Client,
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

fn response_cookies(response: &reqwest::Response) -> Vec<(String, String)> {
    response
        .headers()
        .get_all(reqwest::header::SET_COOKIE)
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

fn account_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法解析应用数据目录: {e}"))?;
    if !dir.exists() {
        fs_dirs(&dir)?;
    }
    Ok(dir.join("account.json"))
}

fn fs_dirs(dir: &PathBuf) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("无法创建数据目录 {}: {e}", dir.display()))
}

fn load_saved_account(app: &AppHandle) -> Option<Account> {
    let path = account_path(app).ok()?;
    let text = std::fs::read_to_string(path).ok()?;
    let account: Account = serde_json::from_str(&text).ok()?;
    account.is_complete().then_some(account)
}

fn save_account(app: &AppHandle, account: &Account) -> Result<(), String> {
    let path = account_path(app)?;
    let text = serde_json::to_string_pretty(&serde_json::json!({
        "dede_user_id": account.dede_user_id,
        "sessdata": account.sessdata,
        "bili_jct": account.bili_jct,
        "buvid3": account.buvid3,
    }))
    .map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| format!("无法保存登录凭据: {e}"))
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

async fn apply_account(
    app: &AppHandle,
    state: &AccountState,
    cookies: &[(String, String)],
) -> Result<(), String> {
    let account = account_from_cookies(&state.client, cookies).await?;
    state
        .client
        .set_account(account.clone())
        .map_err(|e| format!("应用登录凭据失败: {e}"))?;
    save_account(app, &account)
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

async fn status_from_nav(state: &AccountState) -> Result<AccountStatus, String> {
    let nav = state
        .client
        .login()
        .nav()
        .await
        .map_err(|e| format!("获取登录状态失败: {e}"))?;
    let face = match nav.face {
        Some(url) => fetch_face_data_url(&state.http, &url).await.or(Some(url)),
        None => None,
    };
    Ok(AccountStatus {
        logged_in: nav.is_login,
        mid: nav.mid.map(|m| m.get()),
        uname: nav.uname,
        face,
    })
}

async fn fetch_face_data_url(client: &reqwest::Client, url: &str) -> Option<String> {
    let url = url.replace("http://", "https://");
    let response = client
        .get(url)
        .header(reqwest::header::REFERER, "https://www.bilibili.com/")
        .header(reqwest::header::USER_AGENT, "Mozilla/5.0")
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
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
    if load_saved_account(&app).is_none() && state.client.get_account().is_none() {
        return Ok(AccountStatus {
            logged_in: false,
            mid: None,
            uname: None,
            face: None,
        });
    }
    status_from_nav(&state).await
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
    apply_account(&app, &state, &cookies).await?;
    status_from_nav(&state).await
}

#[tauri::command]
pub async fn account_password_login(
    app: AppHandle,
    state: State<'_, AccountState>,
    username: String,
    password: String,
    token: String,
    challenge: String,
    validate: String,
    seccode: String,
) -> Result<AccountStatus, String> {
    let key: ApiResponse = state
        .http
        .get(format!("{PASSPORT}/x/passport-login/web/key"))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    api_error(&key)?;
    let data = key.data.ok_or("登录密钥响应缺少 data")?;
    let hash = data["hash"].as_str().ok_or("登录密钥缺少 hash")?;
    let pem = data["key"].as_str().ok_or("登录密钥缺少 key")?;
    let public_key = RsaPublicKey::from_public_key_pem(pem).map_err(|e| e.to_string())?;
    let mut plain = hash.as_bytes().to_vec();
    plain.extend_from_slice(password.as_bytes());
    let encrypted = public_key
        .encrypt(&mut OsRng, Pkcs1v15Encrypt, &plain)
        .map_err(|e| e.to_string())?;
    let encoded = BASE64.encode(encrypted);
    let response = state
        .http
        .post(format!("{PASSPORT}/x/passport-login/web/login"))
        .form(&[
            ("username", username.trim()),
            ("password", encoded.as_str()),
            ("keep", "1"),
            ("source", "main_web"),
            ("token", token.as_str()),
            ("challenge", challenge.as_str()),
            ("validate", validate.as_str()),
            ("seccode", seccode.as_str()),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let cookies = response_cookies(&response);
    let body: ApiResponse = response.json().await.map_err(|e| e.to_string())?;
    api_error(&body)?;
    apply_account(&app, &state, &cookies).await?;
    status_from_nav(&state).await
}

#[tauri::command]
pub async fn account_logout(app: AppHandle, state: State<'_, AccountState>) -> Result<(), String> {
    let path = account_path(&app)?;
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| format!("无法删除登录凭据: {e}"))?;
    }
    state.client.clear_account();
    Ok(())
}

/// 创建托管的账号状态：恢复本地已保存的登录凭据
pub fn init_state(app: &AppHandle) -> Result<AccountState, Box<dyn std::error::Error>> {
    let client = BpiClient::new()?;
    if let Some(account) = load_saved_account(app) {
        client
            .set_account(account)
            .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
    }
    Ok(AccountState {
        client,
        http: reqwest::Client::builder().cookie_store(true).build()?,
    })
}
