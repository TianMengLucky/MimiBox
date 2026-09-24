//! 封面上传与稿件提交（add/v3）。

use serde::Deserialize;

use super::UploadParams;

const MEMBER: &str = "https://member.bilibili.com";
const UPLOAD_REFERER: &str = "https://member.bilibili.com/platform/upload/video/frame";

#[derive(Deserialize)]
struct Envelope<T> {
    code: i64,
    message: String,
    // Option 字段在响应缺失时自动为 None，无需 serde(default)（否则会给 T 加 Default 约束）
    data: Option<T>,
}

/// 上传封面（data URI 形式），返回 B 站封面 URL
pub async fn upload_cover(
    client: &reqwest::Client,
    cookie: &str,
    csrf: &str,
    data_uri: &str,
) -> Result<String, String> {
    let response = client
        .post(format!("{MEMBER}/x/vu/web/cover/up"))
        .header(reqwest::header::USER_AGENT, super::UA)
        .header(reqwest::header::REFERER, UPLOAD_REFERER)
        .header(reqwest::header::COOKIE, cookie)
        .form(&[("csrf", csrf), ("cover", data_uri)])
        .send()
        .await
        .map_err(|e| format!("封面上传请求失败: {e}"))?;
    let body: Envelope<CoverData> = response
        .json()
        .await
        .map_err(|e| format!("解析封面上传响应失败: {e}"))?;
    if body.code != 0 {
        return Err(format!("封面上传失败: {} ({})", body.message, body.code));
    }
    let url = body
        .data
        .ok_or("封面上传响应缺少数据")?
        .url
        .replace("http://", "https://");
    Ok(url)
}

#[derive(Deserialize)]
struct CoverData {
    url: String,
}

/// 提交稿件，返回 (aid, bvid)
pub async fn submit_archive(
    client: &reqwest::Client,
    cookie: &str,
    csrf: &str,
    params: &UploadParams,
    bili_filename: &str,
    biz_id: i64,
) -> Result<(i64, String), String> {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let body = serde_json::json!({
        "act_reserve_create": 0,
        "copyright": params.copyright,
        "source": if params.copyright == 2 { params.source.as_str() } else { "" },
        "cover": params.cover,
        "desc": params.desc,
        "desc_format_id": 9999,
        "dynamic": params.dynamic,
        "interactive": 0,
        "no_reprint": if params.no_reprint { 1 } else { 0 },
        "open_elec": if params.open_elec { 1 } else { 0 },
        "origin_state": 0,
        "recreate": -1,
        "no_disturbance": 0,
        "dolby": 0,
        "lossless_music": 0,
        "subtitle": { "open": 0, "lan": "" },
        "tag": params.tags.join(","),
        "tid": params.tid,
        "human_type2": 0,
        "title": params.title,
        "up_selection_reply": 0,
        "up_close_reply": 0,
        "up_close_danmu": 0,
        "upclose_danmaku": false,
        "web_os": 3,
        "videos": [{
            "filename": bili_filename,
            "title": "P1",
            "desc": "",
            "cid": biz_id,
        }],
    });
    let response = client
        .post(format!("{MEMBER}/x/vu/web/add/v3"))
        .query(&[("ts", ts.to_string()), ("csrf", csrf.to_string())])
        .header(reqwest::header::USER_AGENT, super::UA)
        .header(reqwest::header::REFERER, UPLOAD_REFERER)
        .header(reqwest::header::COOKIE, cookie)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("提交稿件请求失败: {e}"))?;
    let body: Envelope<ArchiveData> = response
        .json()
        .await
        .map_err(|e| format!("解析提交响应失败: {e}"))?;
    if body.code != 0 {
        return Err(format!("投稿失败: {} ({})", body.message, body.code));
    }
    let data = body.data.ok_or("提交响应缺少数据")?;
    Ok((data.aid, data.bvid))
}

#[derive(Deserialize)]
struct ArchiveData {
    aid: i64,
    bvid: String,
}
