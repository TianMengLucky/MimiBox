//! B 站 WBI 签名（bilibili-API-collect 算法）。
//!
//! `x/space/wbi/arc/search`、`x/v2/reply/wbi/main` 等接口需要在查询串末尾
//! 追加 `wts`（秒级时间戳）与 `w_rid`（参数按 key 排序后 urlencode 拼接
//! mixin key 的 MD5）。mixin key 由 nav 接口的 `wbi_img` 两把公钥按打乱表
//! 重排取前 32 位得到，带 TTL 缓存（公钥每天轮换一次）。

use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use md5::{Digest, Md5};

/// mixin key 重排表（bilibili-API-collect）
const MIXIN_KEY_ENC_TAB: [usize; 64] = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19,
    29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

/// 缓存时效：略短于公钥轮换周期（一天）
const KEYS_TTL: Duration = Duration::from_secs(12 * 60 * 60);

#[derive(Clone)]
struct WbiKeys {
    img_key: String,
    sub_key: String,
}

static KEYS: OnceLock<Mutex<Option<(Instant, WbiKeys)>>> = OnceLock::new();

impl WbiKeys {
    fn mixin_key(&self) -> String {
        let raw: String = format!("{}{}", self.img_key, self.sub_key);
        MIXIN_KEY_ENC_TAB
            .iter()
            .filter_map(|&i| raw.chars().nth(i))
            .take(32)
            .collect()
    }
}

/// 从 wbi_img 图片 URL 中取文件名（去掉扩展名）作为 key
fn key_from_url(url: &str) -> Option<String> {
    let name = url.rsplit('/').next()?;
    let stem = name.split('.').next()?;
    if stem.is_empty() {
        None
    } else {
        Some(stem.to_string())
    }
}

/// 获取（必要时拉取并缓存）WBI 公钥对，返回 mixin key
pub(super) async fn mixin_key(
    http: &reqwest::Client,
    cookie: Option<&str>,
    ua: &str,
) -> Result<String, String> {
    let cell = KEYS.get_or_init(|| Mutex::new(None));
    if let Ok(guard) = cell.lock() {
        if let Some((at, keys)) = guard.as_ref() {
            if at.elapsed() < KEYS_TTL {
                return Ok(keys.mixin_key());
            }
        }
    }

    let mut request = http
        .get("https://api.bilibili.com/x/web-interface/nav")
        .header(reqwest::header::USER_AGENT, ua)
        .header(reqwest::header::REFERER, "https://www.bilibili.com/");
    if let Some(cookie) = cookie {
        request = request.header(reqwest::header::COOKIE, cookie);
    }
    let value: serde_json::Value = request
        .send()
        .await
        .map_err(|e| format!("获取 WBI 公钥失败: {e}"))?
        .json()
        .await
        .map_err(|e| format!("解析 WBI 公钥失败: {e}"))?;
    if value["code"].as_i64() != Some(0) {
        return Err(format!(
            "获取 WBI 公钥失败: {}",
            value["message"].as_str().unwrap_or("未知错误")
        ));
    }

    let img_key = key_from_url(value["data"]["wbi_img"]["img_url"].as_str().unwrap_or(""))
        .ok_or_else(|| "WBI 公钥响应缺少 img_url".to_string())?;
    let sub_key = key_from_url(value["data"]["wbi_img"]["sub_url"].as_str().unwrap_or(""))
        .ok_or_else(|| "WBI 公钥响应缺少 sub_url".to_string())?;
    let keys = WbiKeys { img_key, sub_key };
    let mixin = keys.mixin_key();
    if let Ok(mut guard) = cell.lock() {
        *guard = Some((Instant::now(), keys));
    }
    Ok(mixin)
}

/// RFC3986 子集 urlencode：字母数字与 `-_.~` 之外全部百分号编码
fn urlencode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// 计算 WBI 签名后的完整查询串（含 wts 与 w_rid）
pub(super) fn signed_query(params: &[(String, String)], mixin: &str) -> String {
    let mut parts: Vec<(String, String)> = params
        .iter()
        .map(|(k, v)| {
            // 签名算法要求剔除这些字符
            let filter = |s: &str| s.replace(['!', '\'', '(', ')', '*'], "");
            (filter(k), filter(v))
        })
        .collect();
    let wts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    parts.push(("wts".into(), wts.to_string()));
    parts.sort();

    let query = parts
        .iter()
        .map(|(k, v)| format!("{}={}", urlencode(k), urlencode(v)))
        .collect::<Vec<_>>()
        .join("&");
    let mut hasher = Md5::new();
    hasher.update(query.as_bytes());
    hasher.update(mixin.as_bytes());
    let w_rid = hex::encode(hasher.finalize());
    format!("{query}&w_rid={w_rid}")
}
