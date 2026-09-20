//! B 站视频投稿：封面/视频上传与稿件提交。
//!
//! - 分区表（[`cats.json`]）：静态打包的投稿分区树，来源 bilibili-API-collect
//! - UPOS 分片上传（[`upos`]）：preupload → 逐片 PUT → 合片，X-Upos-Auth 认证
//! - 稿件提交（[`submit`]）：封面 `/x/vu/web/cover/up` 与投稿 `/x/vu/web/add/v3`
//!
//! 上传为长任务：进度经事件 `bilibili-upload-progress` 推送，
//! 取消走 [`UploadState`] 的原子标志，同一时刻只允许一个上传任务。

mod submit;
mod upos;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::account::AccountState;

/// Chrome 137 UA（与其它 B 站模块保持一致）
pub(crate) const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

/// 视频文件可接受的后缀（与前端文件选择框一致）
const VIDEO_EXTS: &[&str] = &[
    "mp4", "flv", "avi", "wmv", "mov", "webm", "mkv", "m4v", "ts", "3gp", "mpeg", "mpg",
];

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadZone {
    pub tid: u16,
    pub name: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadZoneMain {
    pub tid: u16,
    pub name: String,
    pub children: Vec<UploadZone>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadParams {
    /// 视频文件绝对路径（前端经系统文件对话框选择）
    pub video_path: String,
    pub title: String,
    #[serde(default)]
    pub desc: String,
    pub tid: u16,
    #[serde(default)]
    pub tags: Vec<String>,
    /// 1 自制 / 2 转载
    pub copyright: u8,
    /// 转载来源（copyright=2 时必填）
    #[serde(default)]
    pub source: String,
    /// 封面 URL（可空，空则由 B 站自动截取）
    #[serde(default)]
    pub cover: String,
    /// 声明禁止转载
    #[serde(default)]
    pub no_reprint: bool,
    /// 开启充电
    #[serde(default)]
    pub open_elec: bool,
    #[serde(default)]
    pub dynamic: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoFileInfo {
    pub name: String,
    pub size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverUploaded {
    pub url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitOutcome {
    pub aid: i64,
    pub bvid: String,
}

/// 上传任务运行状态：`running` 防并发，`cancel` 供前端请求中止
#[derive(Default)]
pub struct UploadState {
    running: AtomicBool,
    cancel: Arc<AtomicBool>,
}

/// 读取打包的分区表（启动无关，命令调用时惰性解析一次）
pub fn zones() -> Result<Vec<UploadZoneMain>, String> {
    let raw = include_str!("cats.json");
    serde_json::from_str(raw).map_err(|e| format!("内置分区表解析失败: {e}"))
}

/// 从 Cookie 头串中取出指定键的值
fn cookie_value(cookie: &str, name: &str) -> Option<String> {
    cookie.split(';').find_map(|pair| {
        let (key, value) = pair.trim().split_once('=')?;
        key.eq_ignore_ascii_case(name)
            .then(|| value.to_string())
    })
}

/// 投稿分区表（静态内置）
#[tauri::command]
pub async fn bilibili_upload_cats() -> Result<Vec<UploadZoneMain>, String> {
    zones()
}

/// 探测待上传的视频文件（名称与大小），供前端在选择后立即展示
#[tauri::command]
pub async fn bilibili_upload_probe(path: String) -> Result<VideoFileInfo, String> {
    let metadata = std::fs::metadata(&path).map_err(|e| format!("无法读取视频文件: {e}"))?;
    if !metadata.is_file() {
        return Err("所选路径不是文件".into());
    }
    let name = std::path::Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("视频文件路径无效")?
        .to_string();
    let ext_ok = std::path::Path::new(&name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| VIDEO_EXTS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false);
    if !ext_ok {
        return Err("请选择常见格式的视频文件（mp4/mkv/flv 等）".into());
    }
    Ok(VideoFileInfo {
        name,
        size: metadata.len(),
    })
}

/// 上传封面图片（前端读为 data URI），返回可用的封面 URL
#[tauri::command]
pub async fn bilibili_upload_cover(
    app: AppHandle,
    state: State<'_, AccountState>,
    data_uri: String,
) -> Result<CoverUploaded, String> {
    if !data_uri.starts_with("data:image/") {
        return Err("封面数据格式无效".into());
    }
    let (_, cookie) = state
        .bilibili_session(&app)?
        .ok_or_else(|| "请先在账号页登录 B 站账号".to_string())?;
    let csrf = cookie_value(&cookie, "bili_jct").ok_or("登录凭据缺少 csrf")?;
    let client = reqwest::Client::new();
    let url = submit::upload_cover(&client, &cookie, &csrf, &data_uri).await?;
    Ok(CoverUploaded { url })
}

/// 投稿总入口：预上传 → 分片上传 → 合片 → 提交稿件。
/// 进度经事件 `bilibili-upload-progress` 推送；返回即代表任务终结。
#[tauri::command]
pub async fn bilibili_upload_start(
    app: AppHandle,
    state: State<'_, AccountState>,
    upload: State<'_, UploadState>,
    params: UploadParams,
) -> Result<SubmitOutcome, String> {
    if upload
        .running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("已有投稿任务正在进行".into());
    }
    upload.cancel.store(false, Ordering::SeqCst);
    let result = run_upload(&app, &state, &upload, &params).await;
    upload.running.store(false, Ordering::SeqCst);
    upload.cancel.store(false, Ordering::SeqCst);
    result
}

async fn run_upload(
    app: &AppHandle,
    state: &State<'_, AccountState>,
    upload: &UploadState,
    params: &UploadParams,
) -> Result<SubmitOutcome, String> {
    validate(params)?;

    let (_, cookie) = state
        .bilibili_session(app)?
        .ok_or_else(|| "请先在账号页登录 B 站账号".to_string())?;
    let csrf = cookie_value(&cookie, "bili_jct").ok_or("登录凭据缺少 csrf")?;

    let file_name = std::path::Path::new(&params.video_path)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("视频文件路径无效")?
        .to_string();

    // 独立无 Cookie 客户端：upos 服务器与站点 Cookie 无关，避免误带凭据
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建上传客户端失败: {e}"))?;

    let cancel = upload.cancel.clone();
    let progress = move |p: upos::UploadProgress| {
        let _ = app.emit("bilibili-upload-progress", &p);
        !cancel.load(Ordering::Relaxed)
    };

    let (bili_filename, biz_id) =
        upos::upload_file(&client, &cookie, &params.video_path, &file_name, &progress)
            .await
            .map_err(|e| {
                if e == "已取消" {
                    e
                } else {
                    format!("视频上传失败: {e}")
                }
            })?;

    let (aid, bvid) = submit::submit_archive(&client, &cookie, &csrf, params, &bili_filename, biz_id)
        .await
        .map_err(|e| format!("提交稿件失败: {e}"))?;
    Ok(SubmitOutcome { aid, bvid })
}

/// 提交前校验（文件存在性在上传时再校验一次）
fn validate(params: &UploadParams) -> Result<(), String> {
    let title = params.title.trim();
    if title.is_empty() {
        return Err("请填写稿件标题".into());
    }
    if title.chars().count() > 80 {
        return Err("标题最多 80 个字".into());
    }
    let tags: Vec<String> = params
        .tags
        .iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();
    if tags.is_empty() {
        return Err("请至少添加一个标签".into());
    }
    if tags.len() > 10 {
        return Err("标签最多 10 个".into());
    }
    if params.copyright == 2 && params.source.trim().is_empty() {
        return Err("转载稿件请填写转载来源".into());
    }
    if params.desc.chars().count() > 2000 {
        return Err("简介最多 2000 个字".into());
    }
    Ok(())
}

/// 请求取消当前上传（分片间响应）
#[tauri::command]
pub async fn bilibili_upload_cancel(upload: State<'_, UploadState>) -> Result<(), String> {
    upload.cancel.store(true, Ordering::SeqCst);
    Ok(())
}
