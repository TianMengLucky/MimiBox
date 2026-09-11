//! 头像磁盘缓存（B 站/抖音共用）。
//!
//! 以图片 URL 的 SHA-256 摘要为文件名存放在应用数据目录 `avatars/`，
//! 扩展名由下载响应的 content-type 推导。命中缓存直接读磁盘转 data URI，
//! 不再重复请求图片 CDN。

use std::path::Path;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use sha2::{Digest, Sha256};

/// 头像缓存文件名：URL 的 SHA-256 十六进制摘要
fn avatar_cache_key(url: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(url.as_bytes());
    hex::encode(hasher.finalize())
}

/// 读取磁盘缓存的头像并转为 data URI；未命中返回 None
fn cached_avatar(dir: &Path, url: &str) -> Option<String> {
    let hash = avatar_cache_key(url);
    for (ext, mime) in [("jpg", "image/jpeg"), ("png", "image/png"), ("webp", "image/webp"), ("gif", "image/gif")] {
        let path = dir.join(format!("{hash}.{ext}"));
        if let Ok(bytes) = std::fs::read(&path) {
            return Some(format!("data:{mime};base64,{}", BASE64.encode(bytes)));
        }
    }
    None
}

/// 下载头像（B 站/抖音共用）并写入磁盘缓存，返回 data URI。
/// 缓存以图片 URL 为键；下载失败时回退为原始 URL（由前端按需加载）。
pub(super) async fn fetch_face_data_url(client: &wreq::Client, dir: &Path, url: &str) -> Option<String> {
    if let Some(hit) = cached_avatar(dir, url) {
        return Some(hit);
    }
    let url = url.replace("http://", "https://");
    let response = client
        .get(url.as_str())
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
    // 写入磁盘缓存（扩展名由 content-type 推导）；写失败不影响返回
    let ext = match content_type.as_str() {
        "image/png" => "png",
        "image/webp" => "webp",
        "image/gif" => "gif",
        _ => "jpg",
    };
    let path = dir.join(format!("{}.{}", avatar_cache_key(&url), ext));
    if let Err(e) = std::fs::write(&path, &bytes) {
        eprintln!("[avatar] 缓存写入失败 {}: {e}", path.display());
    }
    Some(format!(
        "data:{content_type};base64,{}",
        BASE64.encode(bytes)
    ))
}
