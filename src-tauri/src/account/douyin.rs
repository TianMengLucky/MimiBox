//! 抖音登录命令：扫码（新安全栈）+ 短信二次验证。
//!
//! 扫码会话上下文（安全头/msToken/token）保存在后端 `douyin_web` 会话中，
//! 前端轮询无需传参；2046 二次验证的短信发送/校验由 douyin_web::mfa 完成，
//! 会话在两次调用之间保持（失败也会放回，允许重试）。

use serde::Serialize;
use tauri::webview::Cookie;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

use super::avatar::fetch_face_data_url;
use super::douyin_store::{self, DouyinPersist};
use super::store::data_dir;
use super::{AccountState, DouyinSession};
use crate::douyin_web::{self, PollOutcome};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DouyinQrStart {
    pub qr_image: String,
}

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

fn chrono_like_now() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default()
}

/// 重置抖音 web 会话：剥离登录票据 cookie 并清空扫码会话上下文（模拟用户
/// 刷新页面）。设备级 cookie（ttwid/passport_csrf_token 等）保留——抖音
/// passport 据此识别已验证设备，避免每次登录都触发短信二次验证。
#[tauri::command]
pub async fn douyin_reset_session(state: State<'_, AccountState>) -> Result<(), String> {
    {
        let mut cookies = state.douyin_cookies.lock().map_err(|_| "Cookie锁定失败")?;
        douyin_store::strip_session_cookies(&mut cookies);
    }
    *state.douyin_web.lock().map_err(|_| "会话锁失败")? = None;
    Ok(())
}

/// 在隔离的网页窗口中打开抖音，并注入当前账号的登录 Cookie。
#[tauri::command]
pub async fn douyin_open_web(app: AppHandle, state: State<'_, AccountState>) -> Result<(), String> {
    let session = state
        .douyin
        .lock()
        .map_err(|_| "抖音会话锁定失败")?
        .clone()
        .filter(|session| !session.cookie.is_empty())
        .ok_or_else(|| "当前没有已登录的抖音账号，请先扫码登录".to_string())?;

    let label = format!("douyin-{}", session.uid);
    let douyin_url: tauri::Url = "https://www.douyin.com/"
        .parse()
        .map_err(|e| format!("抖音地址无效: {e}"))?;
    // session.cookie 为 "k1=v1; k2=v2" 请求头格式，拆成键值对注入
    let pairs: Vec<(String, String)> = session
        .cookie
        .split(';')
        .filter_map(|pair| {
            let (name, value) = pair.split_once('=')?;
            let name = name.trim();
            (!name.is_empty() || !value.trim().is_empty())
                .then(|| (name.to_string(), value.trim().to_string()))
        })
        .collect();
    let cookie_script = pairs
        .iter()
        .map(|(name, value)| {
            let cookie = format!("{name}={value}; Domain=.douyin.com; Path=/; Secure; SameSite=None");
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
        let profile_dir = data_dir(&app)?.join("webview-profiles").join(&label);
        WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(douyin_url.clone()))
            .title("抖音")
            .inner_size(1200.0, 800.0)
            .min_inner_size(720.0, 480.0)
            .data_directory(profile_dir)
            .initialization_script(cookie_script)
            .visible(false)
            .build()
            .map_err(|e| format!("无法创建网页窗口: {e}"))?
    };

    for (name, value) in &pairs {
        let cookie = Cookie::build((name.as_str(), value.as_str()))
            .domain(".douyin.com")
            .path("/")
            .secure(true)
            .build();
        webview
            .set_cookie(cookie)
            .map_err(|e| format!("无法设置网页登录凭证: {e}"))?;
    }

    webview
        .navigate(douyin_url)
        .map_err(|e| format!("无法打开抖音网页: {e}"))?;
    webview
        .show()
        .and_then(|_| webview.set_focus())
        .map_err(|e| format!("无法显示抖音网页窗口: {e}"))
}

#[tauri::command]
pub async fn douyin_qr_start(state: State<'_, AccountState>) -> Result<DouyinQrStart, String> {
    // 完整链路：ttwid（aid=10006 回调）→ get_qrcode（bdms a_bogus + X-Ms-Token）
    // → get_client_cert 握手 → DTrait d1 安全头（约 4 秒）
    let (qr_image, session) =
        douyin_web::start(&state.http, &state.douyin_cookies).await?;
    *state.douyin_web.lock().map_err(|_| "会话锁失败")? = Some(session);
    Ok(DouyinQrStart { qr_image })
}

#[tauri::command]
pub async fn douyin_qr_poll(app: AppHandle, state: State<'_, AccountState>) -> Result<DouyinQrPoll, String> {
    // 会话上下文（安全头/msToken/token）全部保存在服务端会话中，前端无需传参
    let outcome = {
        // 不能跨 await 持有 std::MutexGuard（!Send），先把会话 take 出来
        let mut session = state
            .douyin_web
            .lock()
            .map_err(|_| "会话锁失败")?
            .take()
            .ok_or_else(|| "扫码会话不存在，请刷新二维码".to_string())?;
        let result = douyin_web::poll(&state.http, &state.douyin_cookies, &mut session).await;
        // 非 confirmed 结果都要把会话放回去（confirmed 分支会置 None）
        let is_confirmed = matches!(result, Ok(PollOutcome::Confirmed { .. }));
        if !is_confirmed {
            *state.douyin_web.lock().map_err(|_| "会话锁失败")? = Some(session);
        }
        result?
    };

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
        PollOutcome::Confirmed { uid, name, avatar_url, cookie } => {
            let uid_value = uid.unwrap_or_else(|| format!("douyin-{}", chrono_like_now()));
            // 下载头像并写入磁盘缓存（失败不影响登录，face 置 None）
            let face = match &avatar_url {
                Some(url) => fetch_face_data_url(&state.http, &state.avatar_dir, url).await,
                None => None,
            };
            let session = DouyinSession {
                uid: uid_value.clone(),
                name: name.clone(),
                face,
                cookie: cookie.clone(),
            };
            *state.douyin.lock().map_err(|_| "抖音会话锁定失败")? = Some(session.clone());
            *state.douyin_web.lock().map_err(|_| "会话锁失败")? = None;
            // 登录态落盘（完整 cookie jar + 会话）：重启免扫码 + 设备信任延续
            let cookies = state
                .douyin_cookies
                .lock()
                .map_err(|_| "Cookie锁定失败")?
                .clone();
            douyin_store::save(&app, &DouyinPersist { cookies, session: Some(session) });
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
    let result = douyin_web::mfa_send(&state.http, &state.douyin_cookies, &mut session).await;
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
    let result = douyin_web::mfa_validate(&state.http, &state.douyin_cookies, &mut session, &code).await;
    // 验证失败也放回会话，允许用户重新输入/重发；成功同样放回（继续 check 轮询）
    *state.douyin_web.lock().map_err(|_| "会话锁失败")? = Some(session);
    result
}
