//! 跨平台账号管理命令：状态查询、账号列表、复制 Cookie、退出登录。
//!
//! 这些命令同时操作 B 站与抖音两个平台的账号状态（抖音会话优先），
//! 不属于任何单一平台模块。B 站专属命令见 [`super::bilibili`]，
//! 抖音专属命令见 [`super::douyin`]。

use bpi_rs::client::BpiClient;
use tauri::{AppHandle, State};

use super::avatar::fetch_face_data_url;
use super::douyin_store;
use super::store::{load_store, save_store, AccountEntry, AccountStatus, CredentialStatus};
use super::AccountState;

/// 通过 B 站 nav 接口查询凭据状态（头像下载接入磁盘缓存）
pub(super) async fn status_from_client(
    client: &BpiClient,
    http: &wreq::Client,
    avatar_dir: &std::path::Path,
) -> Result<AccountStatus, String> {
    let nav = client
        .login()
        .nav()
        .await
        .map_err(|e| format!("获取登录状态失败: {e}"))?;
    let face = match nav.face {
        Some(url) => fetch_face_data_url(http, avatar_dir, &url).await.or(Some(url)),
        None => None,
    };
    Ok(AccountStatus {
        logged_in: nav.is_login,
        mid: nav.mid.map(|m| m.get()),
        uname: nav.uname,
        face,
    })
}

pub(super) async fn status_from_nav(state: &AccountState) -> Result<AccountStatus, String> {
    status_from_client(&state.client, &state.http, &state.avatar_dir).await
}

/// 查询当前活动账号的登录状态（抖音会话优先，其次 B 站凭据）
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
            face: session.face,
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
            match status_from_client(&client, &state.http, &state.avatar_dir).await {
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
            face: session.face,
            active: true,
            credential_status: CredentialStatus::Valid,
        });
    }
    Ok(entries)
}

/// 返回当前活动账号的浏览器 Cookie 请求头字符串（可直接粘贴到 curl/浏览器）。
/// 抖音会话存在时返回抖音 Cookie，否则返回 B 站活动账号凭据。
#[tauri::command]
pub async fn account_copy_cookie(
    app: AppHandle,
    state: State<'_, AccountState>,
) -> Result<String, String> {
    if let Some(session) = state
        .douyin
        .lock()
        .map_err(|_| "抖音会话锁定失败")?
        .clone()
    {
        if !session.cookie.is_empty() {
            return Ok(session.cookie);
        }
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
    Ok(format!(
        "DedeUserID={}; SESSDATA={}; bili_jct={}; buvid3={}",
        account.dede_user_id, account.sessdata, account.bili_jct, account.buvid3
    ))
}

/// 退出当前活动账号：从列表中移除并清除会话（其他保存的账号不受影响）
#[tauri::command]
pub async fn account_logout(app: AppHandle, state: State<'_, AccountState>) -> Result<(), String> {
    *state.douyin.lock().map_err(|_| "抖音会话锁定失败")? = None;
    // 清除抖音持久化会话并剥离登录票据 cookie（保留设备 cookie 维持设备信任）
    douyin_store::clear_session(&app);
    {
        let mut cookies = state.douyin_cookies.lock().map_err(|_| "Cookie锁定失败")?;
        douyin_store::strip_session_cookies(&mut cookies);
    }
    let mut store = load_store(&app)?;
    if let Some(active) = store.active_id.clone() {
        store.accounts.retain(|a| a.dede_user_id != active);
        store.active_id = None;
        save_store(&app, &store)?;
    }
    state.client.clear_account();
    Ok(())
}
