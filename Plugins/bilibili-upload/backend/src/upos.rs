//! UPOS 视频分片上传（协议来源 bilibili-API-collect 创作中心投稿文档）。
//!
//! 流程：preupload 预上传 → PUT `?uploads` 发起分片任务 → 逐片 PUT 上传
//! → POST 合片。认证靠请求头 `X-Upos-Auth`（预上传返回的 auth），
//! 与 B 站站点 Cookie 无关，因此这里使用独立的无 Cookie 客户端。

use std::io::Read;
use std::time::Instant;

use serde::Serialize;

/// 上传进度事件负载（事件名 `bilibili-upload-progress`，每 200ms 节流）
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadProgress {
    /// preupload | uploading | merging
    pub phase: &'static str,
    pub uploaded: u64,
    pub total: u64,
}

/// 预上传返回的关键字段
struct Preupload {
    auth: String,
    biz_id: i64,
    chunk_size: u64,
    endpoint: String,
    upos_uri: String,
    /// B 站生成的内部文件名（upos_uri 去掉目录与扩展名），提交稿件时作为 videos[].filename
    bili_filename: String,
}

/// 分片任务句柄（发起上传后获得）
struct UposTask {
    base_url: String,
    auth: String,
    upload_id: String,
    biz_id: i64,
}

/// 进度回调：返回 false 表示用户已取消，上传循环立即中断
type ProgressFn<'a> = &'a (dyn Fn(UploadProgress) -> bool + Send + Sync + 'a);

const PROFILE: &str = "ugcfx/bup";
const MEMBER: &str = "https://member.bilibili.com";

/// 请求 member.bilibili.com 的公共头（预上传需要站点 Cookie）
fn member_request(
    client: &reqwest::Client,
    url: String,
    cookie: &str,
) -> reqwest::RequestBuilder {
    client
        .get(url)
        .header(reqwest::header::USER_AGENT, super::UA)
        .header(
            reqwest::header::REFERER,
            "https://member.bilibili.com/platform/upload/video/frame",
        )
        .header(reqwest::header::COOKIE, cookie)
}

/// 预上传：登记文件大小并获取 upos 上传线路、凭证与分片大小
async fn preupload(
    client: &reqwest::Client,
    cookie: &str,
    name: &str,
    size: u64,
    progress: ProgressFn<'_>,
) -> Result<Preupload, String> {
    let url = format!("{MEMBER}/preupload");
    let response = member_request(client, url, cookie)
        .query(&[
            ("name", name.to_string()),
            ("size", size.to_string()),
            ("r", "upos".to_string()),
            ("profile", PROFILE.to_string()),
            ("upcdn", "txa".to_string()),
            ("zone", "cs".to_string()),
            ("ssl", "0".to_string()),
            ("version", "2.14.0.0".to_string()),
            ("build", "2140000".to_string()),
            ("webVersion", "2.13.0".to_string()),
            ("probe_version", "20221109".to_string()),
        ])
        .send()
        .await
        .map_err(|e| format!("预上传请求失败: {e}"))?;
    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("解析预上传响应失败: {e}"))?;

    let take_str = |key: &str| -> Result<String, String> {
        data[key]
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| format!("预上传响应缺少 {key}"))
    };
    let upos_uri = take_str("upos_uri")?;
    let bili_filename = upos_uri
        .rsplit('/')
        .next()
        .unwrap_or("")
        .rsplit_once('.')
        .map(|(stem, _)| stem.to_string())
        .unwrap_or_default();
    let info = Preupload {
        auth: take_str("auth")?,
        biz_id: data["biz_id"].as_i64().ok_or("预上传响应缺少 biz_id")?,
        chunk_size: data["chunk_size"].as_u64().unwrap_or(4 * 1024 * 1024),
        endpoint: take_str("endpoint")?,
        upos_uri,
        bili_filename,
    };
    // 进度事件顺带告知前端"预上传完成、总大小已知"
    progress(UploadProgress {
        phase: "preupload",
        uploaded: 0,
        total: size,
    })
    .then_some(())
    .ok_or("已取消")?;
    Ok(info)
}

impl UposTask {
    /// 发起分片上传任务（PUT `?uploads`）
    async fn start(
        client: &reqwest::Client,
        preupload: &Preupload,
        filesize: u64,
    ) -> Result<UposTask, String> {
        let base_url = format!(
            "https:{}{}",
            preupload.endpoint,
            &preupload.upos_uri["upos://".len()..]
        );
        let response = client
            .put(&base_url)
            .header("X-Upos-Auth", &preupload.auth)
            .query(&[
                ("uploads", "".to_string()),
                ("output", "json".to_string()),
                ("profile", PROFILE.to_string()),
                ("filesize", filesize.to_string()),
                ("partsize", preupload.chunk_size.to_string()),
                ("biz_id", preupload.biz_id.to_string()),
            ])
            .send()
            .await
            .map_err(|e| format!("发起上传任务失败: {e}"))?;
        let data: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("解析上传任务响应失败: {e}"))?;
        if data["OK"].as_i64() != Some(1) {
            return Err(format!("发起上传任务被拒绝: {}", truncate(&data.to_string(), 200)));
        }
        let upload_id = data["upload_id"]
            .as_str()
            .ok_or("上传任务响应缺少 upload_id")?
            .to_string();
        Ok(UposTask {
            base_url,
            auth: preupload.auth.clone(),
            upload_id,
            biz_id: preupload.biz_id,
        })
    }
}

/// 完整上传一个文件：预上传 → 分片 → 合片，返回 (B 站内部文件名, biz_id)。
/// `progress` 每片后调用一次，返回 false 时中止（已取消）。
pub async fn upload_file(
    client: &reqwest::Client,
    cookie: &str,
    path: &str,
    name: &str,
    progress: ProgressFn<'_>,
) -> Result<(String, i64), String> {
    let file = std::fs::File::open(path).map_err(|e| format!("无法读取视频文件: {e}"))?;
    let total = file
        .metadata()
        .map_err(|e| format!("无法读取文件大小: {e}"))?
        .len();

    let preupload = preupload(client, cookie, name, total, progress).await?;
    let task = UposTask::start(client, &preupload, total).await?;

    let chunk_size = preupload.chunk_size.max(1024 * 1024) as usize;
    let chunks_total = total.div_ceil(chunk_size as u64);
    let mut reader = std::io::BufReader::with_capacity(chunk_size, file);
    let mut uploaded: u64 = 0;
    let mut buffer = vec![0u8; chunk_size];
    let mut last_emit = Instant::now();
    let mut index: u32 = 0;

    loop {
        let mut filled = 0usize;
        while filled < chunk_size {
            match reader.read(&mut buffer[filled..]) {
                Ok(0) => break,
                Ok(n) => filled += n,
                Err(e) => return Err(format!("读取视频文件失败: {e}")),
            }
        }
        if filled == 0 {
            break;
        }
        let bytes = &buffer[..filled];
        let query = [
            ("partNumber", (index + 1).to_string()),
            ("uploadId", task.upload_id.clone()),
            ("chunk", index.to_string()),
            ("chunks", chunks_total.to_string()),
            ("size", filled.to_string()),
            ("start", uploaded.to_string()),
            ("end", (uploaded + filled as u64).to_string()),
            ("total", total.to_string()),
        ];
        let response = client
            .put(&task.base_url)
            .header("X-Upos-Auth", &task.auth)
            .query(&query)
            .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
            .body(bytes.to_vec())
            .send()
            .await
            .map_err(|e| format!("上传分片 {} 失败: {e}", index + 1))?;
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        if !status.is_success() || !(text.contains("SUCCESS") || text.contains("\"OK\"")) {
            return Err(format!(
                "上传分片 {} 失败 ({}): {}",
                index + 1,
                status,
                truncate(&text, 200)
            ));
        }
        uploaded += filled as u64;
        index += 1;
        // 进度节流：距上次事件不足 200ms 时跳过，避免事件风暴
        if last_emit.elapsed().as_millis() >= 200 || filled < chunk_size {
            last_emit = Instant::now();
            if !progress(UploadProgress {
                phase: "uploading",
                uploaded,
                total,
            }) {
                return Err("已取消".into());
            }
        }
    }

    // 合片（POST，parts 固定 eTag 占位即可）
    let parts: Vec<serde_json::Value> = (1..=chunks_total)
        .map(|part| serde_json::json!({ "partNumber": part, "eTag": "etag" }))
        .collect();
    let response = client
        .post(&task.base_url)
        .header("X-Upos-Auth", &task.auth)
        .query(&[
            ("output", "json".to_string()),
            ("name", name.to_string()),
            ("profile", PROFILE.to_string()),
            ("uploadId", task.upload_id.clone()),
            ("biz_id", task.biz_id.to_string()),
        ])
        .json(&serde_json::json!({ "parts": parts }))
        .send()
        .await
        .map_err(|e| format!("合片请求失败: {e}"))?;
    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("解析合片响应失败: {e}"))?;
    if data["OK"].as_i64() != Some(1) && data["ret"].as_i64() != Some(0) {
        return Err(format!("合片失败: {}", truncate(&data.to_string(), 200)));
    }
    if !progress(UploadProgress {
        phase: "merging",
        uploaded: total,
        total,
    }) {
        return Err("已取消".into());
    }
    Ok((preupload.bili_filename, preupload.biz_id))
}

/// 截断原始响应片段，避免错误信息过长
fn truncate(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        text.to_string()
    } else {
        let cut: String = text.chars().take(max_chars).collect();
        format!("{cut}…")
    }
}
