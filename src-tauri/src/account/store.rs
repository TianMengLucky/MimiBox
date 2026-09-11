//! 多账号数据持久化（accounts.json）与前端状态类型。
//!
//! - `StoredAccount`/`AccountStore`：磁盘上的凭据列表（含缓存的昵称/头像）
//! - `AccountStatus`/`AccountEntry`/`CredentialStatus`：交给前端的查询结果
//!
//! 凭据列表文件位于应用数据目录 `accounts.json`（账号列表 + 当前活动账号），
//! 首次运行文件不存在时返回空列表。

use std::path::PathBuf;

use bpi_rs::session::Account;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// 保存到 accounts.json 的单条账号记录（含缓存的昵称/头像）
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct StoredAccount {
    pub(super) dede_user_id: String,
    pub(super) sessdata: String,
    pub(super) bili_jct: String,
    pub(super) buvid3: String,
    #[serde(default)]
    pub(super) uname: Option<String>,
    #[serde(default)]
    pub(super) face: Option<String>,
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

    pub(super) fn to_account(&self) -> Account {
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
pub(super) struct AccountStore {
    pub(super) active_id: Option<String>,
    pub(super) accounts: Vec<StoredAccount>,
}

/// 交给前端的账号查询状态
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountStatus {
    pub(super) logged_in: bool,
    pub(super) mid: Option<u64>,
    pub(super) uname: Option<String>,
    pub(super) face: Option<String>,
}

impl AccountStatus {
    pub(super) fn not_logged_in() -> Self {
        Self {
            logged_in: false,
            mid: None,
            uname: None,
            face: None,
        }
    }

    /// 网络异常时的兜底状态：凭据已生效，仅缺少资料
    pub(super) fn offline(account: &Account, uname: Option<String>, face: Option<String>) -> Self {
        Self {
            logged_in: true,
            mid: account.dede_user_id.parse().ok(),
            uname,
            face,
        }
    }
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

pub(super) fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
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

pub(super) fn save_store(app: &AppHandle, store: &AccountStore) -> Result<(), String> {
    let path = accounts_path(app)?;
    let text =
        serde_json::to_string_pretty(store).map_err(|e| format!("序列化账号列表失败: {e}"))?;
    std::fs::write(path, text).map_err(|e| format!("无法保存账号列表: {e}"))
}

/// 读取账号列表；文件不存在（首次运行）时返回空列表
pub(super) fn load_store(app: &AppHandle) -> Result<AccountStore, String> {
    let path = accounts_path(app)?;
    if !path.exists() {
        return Ok(AccountStore::default());
    }
    let text = std::fs::read_to_string(&path).map_err(|e| format!("无法读取账号列表: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("账号列表解析失败: {e}"))
}

/// 登录成功或资料更新时写入/更新账号记录并设为活动账号
pub(super) fn persist_account(
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
