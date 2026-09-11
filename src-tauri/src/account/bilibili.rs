//! Bilibili 登录与多账号管理命令（基于 bpi-rs）。
//!
//! - 二维码登录：Rust 端用 bpi-rs 获取登录 URL，再用 `qrcode` 渲染为 PNG，
//!   以 data URL 交给前端展示；轮询状态由前端定时调用 `account_qr_poll`。
//! - 短信/密码登录：先 `account_captcha` 取 Geetest，前端完成人机验证后发送短信。
//! - 多账号：登录成功后的 Cookie 凭据经 `store` 模块持久化，支持切换/退出。

use std::io::Cursor;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use bpi_rs::client::BpiClient;
use bpi_rs::login::params::LoginQrPollParams;
use bpi_rs::session::Account;
use serde::{Deserialize, Serialize};
use tauri::webview::Cookie;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

use super::manage::status_from_nav;
use super::store::{data_dir, load_store, persist_account, save_store, AccountStatus};
use super::AccountState;

/// 二维码轮询状态码（bilibili-API-collect）
const QR_CODE_SUCCESS: i32 = 0;
const QR_CODE_EXPIRED: i32 = 86038;
const QR_CODE_SCANNED: i32 = 86090;
const QR_CODE_WAITING: i32 = 86101;

const PASSPORT: &str = "https://passport.bilibili.com";

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
    let cookies = super::response_cookies(&response);
    let body: ApiResponse = response.json().await.map_err(|e| e.to_string())?;
    api_error(&body)?;
    apply_account(&app, &state, &cookies).await
}
