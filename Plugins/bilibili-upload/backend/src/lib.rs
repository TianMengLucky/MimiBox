//! B 站投稿插件后端：封面/视频上传与稿件提交。
//!
//! - 分区表（cats.json）：静态打包的投稿分区树，来源 bilibili-API-collect
//! - UPOS 分片上传（upos）：preupload → 逐片 PUT → 合片，X-Upos-Auth 认证
//! - 稿件提交（submit）：封面 `/x/vu/web/cover/up` 与投稿 `/x/vu/web/add/v3`
//!
//! 上传为长任务：进度经宿主 emit 事件 `bilibili-upload-progress` 推送，
//! 取消走插件内部的上传任务状态，同一时刻只允许一个上传任务。
//! 依赖账号服务（manifest requires: ["account"]）。

mod submit;
mod upos;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use mimibox_plugin::{export_plugin, InvokeCtx, PluginBackend, Registry};
use serde::{Deserialize, Serialize};

/// Chrome 137 UA（与其它 B 站插件保持一致）
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

#[derive(Deserialize, Default)]
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

/// 上传任务运行状态：`running` 防并发，`cancel` 供前端请求中止。
/// 存放在插件实例内部（随插件加载，不再由宿主 app.manage 托管）。
#[derive(Default)]
struct UploadState {
    running: AtomicBool,
    cancel: Arc<AtomicBool>,
}

/// 探测命令入参
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ProbeArgs {
    path: String,
}

/// 封面上传命令入参
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct CoverArgs {
    data_uri: String,
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
fn zones() -> Result<Vec<UploadZoneMain>, String> {
    let raw = include_str!("cats.json");
    serde_json::from_str(raw).map_err(|e| format!("内置分区表解析失败: {e}"))
}

/// 探测待上传的视频文件（名称与大小），供前端在选择后立即展示
fn probe(path: &str) -> Result<VideoFileInfo, String> {
    let metadata = std::fs::metadata(path).map_err(|e| format!("无法读取视频文件: {e}"))?;
    if !metadata.is_file() {
        return Err("所选路径不是文件".into());
    }
    let name = std::path::Path::new(path)
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

/// 插件实例：持有上传任务状态（handler 经 Arc 共享）
struct BilibiliUploadPlugin {
    state: Arc<UploadState>,
}

impl BilibiliUploadPlugin {
    /// 投稿总入口：预上传 → 分片上传 → 合片 → 提交稿件。
    /// 进度经宿主 emit 事件 `bilibili-upload-progress` 推送；返回即代表任务终结。
    async fn start_upload(
        &self,
        ctx: &InvokeCtx,
        params: &UploadParams,
    ) -> Result<SubmitOutcome, String> {
        if self
            .state
            .running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err("已有投稿任务正在进行".into());
        }
        self.state.cancel.store(false, Ordering::SeqCst);
        let result = self.run_upload(ctx, params).await;
        self.state.running.store(false, Ordering::SeqCst);
        self.state.cancel.store(false, Ordering::SeqCst);
        result
    }

    async fn run_upload(
        &self,
        ctx: &InvokeCtx,
        params: &UploadParams,
    ) -> Result<SubmitOutcome, String> {
        validate(params)?;

        let credentials = ctx.host.bili_credentials(None)?;
        if credentials.mid == 0 {
            return Err("请先在账号页登录 B 站账号".to_string());
        }
        let cookie = credentials.cookie;
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

        let cancel = self.state.cancel.clone();
        let host = ctx.host.clone();
        let progress = move |p: upos::UploadProgress| {
            let payload = serde_json::to_value(&p).unwrap_or(serde_json::Value::Null);
            let _ = host.emit("bilibili-upload-progress", &payload);
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
}

impl PluginBackend for BilibiliUploadPlugin {
    fn register(&self, registry: &mut Registry) {
        registry.handle("bilibili_upload_cats", |_ctx: InvokeCtx, _args: ()| async move {
            zones()
        });

        registry.handle(
            "bilibili_upload_probe",
            |_ctx: InvokeCtx, args: ProbeArgs| async move { probe(&args.path) },
        );

        registry.handle(
            "bilibili_upload_cover",
            |ctx: InvokeCtx, args: CoverArgs| async move {
                if !args.data_uri.starts_with("data:image/") {
                    return Err("封面数据格式无效".into());
                }
                let credentials = ctx.host.bili_credentials(None)?;
                if credentials.mid == 0 {
                    return Err("请先在账号页登录 B 站账号".to_string());
                }
                let csrf =
                    cookie_value(&credentials.cookie, "bili_jct").ok_or("登录凭据缺少 csrf")?;
                let client = reqwest::Client::new();
                let url = submit::upload_cover(&client, &credentials.cookie, &csrf, &args.data_uri)
                    .await?;
                Ok(CoverUploaded { url })
            },
        );

        let state = self.state.clone();
        registry.handle(
            "bilibili_upload_start",
            move |ctx: InvokeCtx, params: UploadParams| {
                let state = state.clone();
                async move {
                    let plugin = BilibiliUploadPlugin { state };
                    plugin.start_upload(&ctx, &params).await
                }
            },
        );

        let state = self.state.clone();
        registry.handle(
            "bilibili_upload_cancel",
            move |_ctx: InvokeCtx, _args: ()| {
                let state = state.clone();
                async move {
                    state.cancel.store(true, Ordering::SeqCst);
                    Ok(())
                }
            },
        );
    }
}

/// 构造插件实例（注册时由 export_plugin 宏调用一次，任务状态随之建立）
fn make_plugin() -> BilibiliUploadPlugin {
    BilibiliUploadPlugin {
        state: Arc::new(UploadState::default()),
    }
}

export_plugin!(make_plugin());
