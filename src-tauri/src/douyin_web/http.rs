//! 抖音 passport HTTP 层：手工 cookie jar、通用请求、重定向跟随、ttwid 引导。

use std::sync::Mutex;

use serde_json::{json, Value};

use super::profile_ua;
use crate::account::response_cookies;

pub(super) const TTWID_REGISTER_URL: &str = "https://ttwid.bytedance.com/ttwid/union/register/";

pub(super) fn merge_cookies(slot: &Mutex<Vec<(String, String)>>, fresh: Vec<(String, String)>) -> Result<(), String> {
    if fresh.is_empty() {
        return Ok(());
    }
    let mut jar = slot.lock().map_err(|_| "Cookie锁定失败")?;
    for (k, v) in fresh {
        if let Some(existing) = jar.iter_mut().find(|(key, _)| key == &k) {
            existing.1 = v;
        } else {
            jar.push((k, v));
        }
    }
    Ok(())
}

pub(super) fn cookie_header(slot: &Mutex<Vec<(String, String)>>) -> Result<String, String> {
    let jar = slot.lock().map_err(|_| "Cookie锁定失败")?;
    Ok(jar.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("; "))
}

pub(super) fn cookie_value(slot: &Mutex<Vec<(String, String)>>, name: &str) -> Result<String, String> {
    let jar = slot.lock().map_err(|_| "Cookie锁定失败")?;
    Ok(jar.iter().find_map(|(k, v)| (k == name).then_some(v.clone())).unwrap_or_default())
}

pub(super) struct HttpResponse {
    pub(super) payload: Value,
    pub(super) ms_token: String,
}

/// passport 通用请求（JSON 响应）。body 为 None 时发 GET，否则按表单 POST。
pub(super) async fn passport_request(
    http: &wreq::Client,
    cookie_slot: &Mutex<Vec<(String, String)>>,
    method: wreq::Method,
    full_url: &str,
    body: Option<&str>,
    extra_headers: &[(String, String)],
    referer: Option<&str>,
) -> Result<HttpResponse, String> {
    let cookie = cookie_header(cookie_slot)?;
    let portrait = format!("{}.login", super::params::uuid_v4());
    let mut rb = http
        .request(method, full_url)
        .header(wreq::header::USER_AGENT, profile_ua())
        .header(wreq::header::ACCEPT, "application/json, text/plain, */*")
        .header(wreq::header::ORIGIN, super::NEXT_URL)
        .header(wreq::header::REFERER, referer.unwrap_or(&format!("{}/", super::NEXT_URL)))
        .header("X-Tt-Passport-Verify-Portrait", &portrait);
    if !cookie.is_empty() {
        rb = rb.header(wreq::header::COOKIE, &cookie);
    }
    if let Some(form) = body {
        rb = rb.header(wreq::header::CONTENT_TYPE, "application/x-www-form-urlencoded").body(form.to_string());
    }
    for (k, v) in extra_headers {
        rb = rb.header(k.as_str(), v.as_str());
    }

    let resp = rb.send().await.map_err(|e| format!("网络请求失败: {e}"))?;
    let status = resp.status().as_u16();
    merge_cookies(cookie_slot, response_cookies(&resp))?;
    let ms_token = resp
        .headers()
        .get("x-ms-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let text = resp.text().await.map_err(|e| format!("读取响应失败: {e}"))?;
    if !(200..300).contains(&status) {
        return Err(format!("HTTP {status}: {}", text.chars().take(300).collect::<String>()));
    }
    let payload: Value = serde_json::from_str(&text).map_err(|e| format!("响应 JSON 解析失败: {e}; body={}", text.chars().take(300).collect::<String>()))?;
    Ok(HttpResponse { payload, ms_token })
}

/// 手动跟随 3xx 跳转并逐步收集 Set-Cookie（ttwid 回调 / confirmed 落地用）
pub(super) async fn follow_with_cookies(http: &wreq::Client, cookie_slot: &Mutex<Vec<(String, String)>>, start_url: &str) -> Result<(), String> {
    let mut url = start_url.to_string();
    for _ in 0..6 {
        let cookie = cookie_header(cookie_slot)?;
        let mut rb = http
            .get(&url)
            .header(wreq::header::USER_AGENT, profile_ua())
            .redirect(wreq::redirect::Policy::none());
        if !cookie.is_empty() {
            rb = rb.header(wreq::header::COOKIE, &cookie);
        }
        let resp = rb.send().await.map_err(|e| format!("回调请求失败: {e}"))?;
        let status = resp.status().as_u16();
        merge_cookies(cookie_slot, response_cookies(&resp))?;
        if (300..400).contains(&status) {
            if let Some(location) = resp.headers().get(wreq::header::LOCATION).and_then(|v| v.to_str().ok()) {
                url = location.to_string();
                continue;
            }
        }
        if (200..400).contains(&status) {
            return Ok(());
        }
        return Err(format!("回调返回 HTTP {status}"));
    }
    Err("回调重定向次数过多".into())
}

/// 流程 1：ttwid（aid=10006 / sso.douyin.com + redirect_url 回调）
pub(super) async fn bootstrap_ttwid(http: &wreq::Client, cookie_slot: &Mutex<Vec<(String, String)>>) -> Result<(), String> {
    let payload = json!({
        "aid": 10006,
        "service": "sso.douyin.com",
        "needFid": false,
        "union": true,
        "unionHost": "https://ttwid.bytedance.com",
        "migrate_info": null,
        "fid": ""
    });
    let resp = http
        .post(TTWID_REGISTER_URL)
        .header(wreq::header::CONTENT_TYPE, "application/json")
        .header(wreq::header::USER_AGENT, profile_ua())
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("ttwid register 请求失败: {e}"))?;
    let data: Value = resp.json().await.map_err(|e| format!("ttwid register 响应解析失败: {e}"))?;
    let redirect_url = data.get("redirect_url").and_then(Value::as_str).unwrap_or_default();
    if redirect_url.is_empty() {
        return Err("ttwid register 未返回 redirect_url".into());
    }
    follow_with_cookies(http, cookie_slot, redirect_url).await?;
    if cookie_value(cookie_slot, "ttwid")?.is_empty() {
        return Err("ttwid 回调后仍未取得 ttwid cookie".into());
    }
    Ok(())
}
