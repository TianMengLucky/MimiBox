//! 抖音 web 扫码登录（新安全栈）
//!
//! 移植自 Go 参考实现 douyin-web-qr-login（goja 跑官方 bdms/dtrait 的纯 HTTP 方案，
//! 已在本机真机验证通过）。核心链路：
//! 1. ttwid register（aid=10006 / sso.douyin.com + redirect_url 回调）
//! 2. get_qrcode（新参数集 + QuickJS bdms 1.0.1.20 产 a_bogus，捕获响应头 X-Ms-Token）
//! 3. ticket_guard/get_client_cert 握手 → QuickJS dtrait 1.0.29 产 5 个安全头
//! 4. check_qrconnect 轮询（固定安全头 + 每次新 a_bogus，msToken 用响应头轮换）
//! 5. confirmed：跟随 redirect_url 落 cookie → self profile 校验 → 会话落库
//!
//! 扫码短信二次验证（error 2046）由本模块 mfa_send/mfa_validate 处理。

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::account::response_cookies;

const GET_QR_URL: &str = "https://login.douyin.com/passport/web/get_qrcode/";
const CHECK_QR_URL: &str = "https://login.douyin.com/passport/web/check_qrconnect/";
const TTWID_REGISTER_URL: &str = "https://ttwid.bytedance.com/ttwid/union/register/";
const DTRAIT_CERT_URL: &str = "https://login.douyin.com/passport/ticket_guard/get_client_cert/";
const SELF_PROFILE_URL: &str = "https://www.douyin.com/aweme/v1/web/user/profile/self/";
const NEXT_URL: &str = "https://www.douyin.com";

const PROFILE_JSON: &str = include_str!("../resources/douyin/protocol_profile.json");

#[derive(Clone, Debug)]
pub struct ProtocolProfile {
    pub aid: String,
    pub passport_jssdk_version: String,
    pub p_ui: String,
    pub p_ca: String,
    pub p_ca_real: String,
    pub p_zt: String,
    pub p_ver: String,
    pub p_bd: String,
    pub dtrait_container_version: String,
    pub user_agent: String,
}

impl ProtocolProfile {
    pub fn load() -> Result<Self, String> {
        let v: Value = serde_json::from_str(PROFILE_JSON).map_err(|e| format!("解析 protocol_profile.json 失败: {e}"))?;
        let get = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
        Ok(Self {
            aid: get("aid"),
            passport_jssdk_version: get("passport_jssdk_version"),
            p_ui: get("p_ui"),
            p_ca: get("p_ca"),
            p_ca_real: get("p_ca_real"),
            p_zt: get("p_zt"),
            p_ver: get("p_ver"),
            p_bd: get("p_bd"),
            dtrait_container_version: get("dtrait_container_version"),
            user_agent: get("user_agent"),
        })
    }
}

/// 一次扫码会话的握手上下文（get_qrcode 后建立，check 轮询复用）
pub struct DouyinWebSession {
    pub token: String,
    pub frontier: bool,
    /// 服务端响应头轮换的 msToken（首帧来自 get_qrcode）
    pub ms_token: String,
    pub trace_id: String,
    pub source_info: String,
    pub verify_fp: String,
    /// get_client_cert + DTrait 产出的 5 个安全头，整轮轮询复用
    pub security_headers: Vec<(String, String)>,
    /// error 2046 二次验证数据（encrypt_uid/verify_ticket/verify_ways/common_params）
    pub pending_verify: Option<Value>,
    /// 短信验证通过后的票据：随后续 check 请求体上送（verify_ticket/std_verify_way）
    pub verification: Vec<(String, String)>,
}

/// 轮询结果（前端状态由 account.rs 映射）
pub enum PollOutcome {
    /// 等待扫码（status 1/new）
    Waiting,
    /// 已扫码待确认（status 2/scanned）
    Scanned,
    /// error_code 7 频控：前端继续退避
    RateLimited,
    /// status 4：无感换码（新 token 已在服务端会话内更新，这里只带新二维码图片）
    Refreshed { qr_data_uri: String },
    /// status 5：二维码过期
    Expired,
    /// error 2046：需要短信二次验证（后端已自动发送验证码，mobile 可能为空）
    VerificationRequired { mobile: Option<String> },
    /// error 2046：需要二次验证但账号没有短信验证方式（如仅人脸/运营商验证），
    /// 桌面端无法完成，message 引导用户去抖音 App 验证后重新扫码
    VerificationUnsupported { message: String },
    /// status 3/confirmed：cookie 已落库
    Confirmed { uid: Option<String>, name: Option<String>, cookie: String },
}

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

fn now_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or_default()
}

fn random_hex(byte_len: usize) -> String {
    use rand::RngCore;
    let mut bytes = vec![0u8; byte_len];
    rand::rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// UUID v4 风格（无连字符时另行替换）
fn uuid_v4() -> String {
    use rand::Rng;
    let mut hex = random_hex(16);
    hex.replace_range(12..13, "4");
    let variant = b"89ab"[rand::rng().random_range(0..4)] as char;
    hex.replace_range(16..17, &variant.to_string());
    format!("{}-{}-{}-{}-{}", &hex[0..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..32])
}

fn random_digits(len: usize) -> String {
    use rand::Rng;
    (0..len).map(|_| char::from(b'0' + rand::rng().random_range(0..10))).collect()
}

/// Go url.QueryEscape：字母数字与 -_.~ 不转义，空格 → +，其余字节 %XX（大写）
fn q_escape(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for &b in input.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn encode_pairs(pairs: &[(String, String)]) -> String {
    pairs.iter().map(|(k, v)| format!("{}={}", q_escape(k), q_escape(v))).collect::<Vec<_>>().join("&")
}

/// p_no：passport SDK 版本参数的 SHA256 摘要（键名字典序，& 连接）
/// get_qrcode 时 pca 传 "0"，check 时传 profile.p_ca
fn p_no(profile: &ProtocolProfile, p_ts: &str, pca: &str) -> String {
    let mut values = [
        ("passport_jssdk_version", profile.passport_jssdk_version.as_str()),
        ("p_bd", profile.p_bd.as_str()),
        ("p_ca", pca),
        ("p_ts", p_ts),
        ("p_ver", profile.p_ver.as_str()),
        ("p_zt", profile.p_zt.as_str()),
    ];
    values.sort_by(|a, b| a.0.cmp(b.0));
    let raw = values.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("&");
    let digest = Sha256::digest(raw.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

fn xor5_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b ^ 5)).collect()
}

/// account_sdk_source_info：环境指纹 JSON 逐字节 XOR 5 后十六进制
/// 字段集合与 Go 参考一致；serde_json 默认 BTreeMap 保证键名字典序，
/// 与 Go encoding/json 对 map 的输出顺序一致。
fn encode_source_info() -> String {
    let cpu = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(8);
    let source = json!({
        "hardwareConcurrency": cpu,
        "webdriver": false,
        "chromedriver": false,
        "shelldriver": false,
        "plugins": 5,
        "innerHeight": 919,
        "innerWidth": 842,
        "outerHeight": 1040,
        "outerWidth": 1920,
        "webgl": {
            "vendor": "Google Inc. (NVIDIA)",
            "renderer": "ANGLE (NVIDIA, Direct3D11 vs_5_0 ps_5_0, D3D11)"
        },
        "performance": {
            "timeOrigin": (now_ms() as i64) - 500,
            "usedJSHeapSize": 33554432i64,
            "navigationTiming": {
                "decodedBodySize": 7500,
                "entryType": "navigation",
                "initiatorType": "navigation",
                "name": format!("{NEXT_URL}/login_page?service={NEXT_URL}"),
                "renderBlockingStatus": "non-blocking",
                "serverTiming": "cdn-cache,edge,origin,inner",
                "guleStart": "none",
                "guleDuration": "none"
            }
        },
        "browser": {
            "t": random_digits(13),
            "bit_protocol": "false",
            "bit_helper": false
        }
    });
    let raw = serde_json::to_vec(&source).expect("source_info 序列化失败");
    xor5_hex(&raw)
}

fn make_verify_fp() -> String {
    // Go: "verify_" + unix_ms 的 36 进制 + "_" + uuid
    let ts = now_ms();
    let mut n = ts;
    let mut digits = String::new();
    const ALPHABET: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if n == 0 {
        digits.push('0');
    }
    while n > 0 {
        digits.insert(0, ALPHABET[(n % 36) as usize] as char);
        n /= 36;
    }
    format!("verify_{digits}_{}", uuid_v4())
}

// ---------------------------------------------------------------------------
// cookie 手工 jar（AccountState 内的 Vec）
// ---------------------------------------------------------------------------

fn merge_cookies(slot: &Mutex<Vec<(String, String)>>, fresh: Vec<(String, String)>) -> Result<(), String> {
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

fn cookie_header(slot: &Mutex<Vec<(String, String)>>) -> Result<String, String> {
    let jar = slot.lock().map_err(|_| "Cookie锁定失败")?;
    Ok(jar.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("; "))
}

fn cookie_value(slot: &Mutex<Vec<(String, String)>>, name: &str) -> Result<String, String> {
    let jar = slot.lock().map_err(|_| "Cookie锁定失败")?;
    Ok(jar.iter().find_map(|(k, v)| (k == name).then_some(v.clone())).unwrap_or_default())
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

struct HttpResponse {
    payload: Value,
    ms_token: String,
}

/// passport 通用请求（JSON 响应）。body 为 None 时发 GET，否则按表单 POST。
async fn passport_request(
    http: &wreq::Client,
    cookie_slot: &Mutex<Vec<(String, String)>>,
    method: wreq::Method,
    full_url: &str,
    body: Option<&str>,
    extra_headers: &[(String, String)],
    referer: Option<&str>,
) -> Result<HttpResponse, String> {
    let cookie = cookie_header(cookie_slot)?;
    let portrait = format!("{}.login", uuid_v4());
    let mut rb = http
        .request(method, full_url)
        .header(wreq::header::USER_AGENT, profile_ua())
        .header(wreq::header::ACCEPT, "application/json, text/plain, */*")
        .header(wreq::header::ORIGIN, NEXT_URL)
        .header(wreq::header::REFERER, referer.unwrap_or(&format!("{NEXT_URL}/")))
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

/// passport 响应校验：message == "success" 且 data.error_code 缺省/为 0
fn response_data(payload: &Value) -> Result<Value, String> {
    let data = payload.get("data").cloned().unwrap_or(json!({}));
    let code = data.get("error_code").and_then(Value::as_i64);
    let ok_code = code.is_none() || code == Some(0);
    if payload.get("message").and_then(Value::as_str) != Some("success") || !ok_code {
        let code = code.unwrap_or(-1);
        let desc = data.get("description").and_then(Value::as_str).unwrap_or("").to_string();
        return Err(api_error(code, &desc, &data));
    }
    Ok(data)
}

/// 错误编码：`__douyin_api_error__\x1f{code}\x1f{desc}\x1f{data_json}`
/// （\x1f 单元分隔符不会出现在中文描述/JSON 中）
fn api_error(code: i64, desc: &str, data: &Value) -> String {
    format!("\u{1f}__douyin_api_error__\u{1f}{code}\u{1f}{desc}\u{1f}{data}")
}

pub struct ApiErrorDetail {
    pub code: i64,
    pub desc: String,
    pub data: Value,
}

/// 解析 passport API 错误（携带完整 data，供 2046 二次验证流程使用）
pub fn parse_api_error(err: &str) -> Option<ApiErrorDetail> {
    let parts: Vec<&str> = err.split('\u{1f}').collect();
    if parts.len() < 5 || parts[1] != "__douyin_api_error__" {
        return None;
    }
    Some(ApiErrorDetail {
        code: parts[2].parse().ok()?,
        desc: parts[3].to_string(),
        data: serde_json::from_str(parts[4]).unwrap_or(Value::Null),
    })
}

/// 手动跟随 3xx 跳转并逐步收集 Set-Cookie（ttwid 回调 / confirmed 落地用）
async fn follow_with_cookies(http: &wreq::Client, cookie_slot: &Mutex<Vec<(String, String)>>, start_url: &str) -> Result<(), String> {
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

/// QuickJS bdms 签名（阻塞约 0.2–1s），放到阻塞线程池执行
async fn sign_a_bogus(target_url: String, method: String, body: String, ua: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || crate::douyin_signer::sign(&target_url, &method, &body, &ua))
        .await
        .map_err(|e| format!("签名任务执行失败: {e}"))?
}

/// QuickJS DTrait 安全头（阻塞约 4s）
async fn build_dtrait_headers(
    target_url: String,
    body: String,
    ua: String,
    server_params: HashMap<String, String>,
) -> Result<HashMap<String, String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::douyin_signer::dtrait_headers(&target_url, "POST", &body, &ua, &server_params)
    })
    .await
    .map_err(|e| format!("DTrait 任务执行失败: {e}"))?
}

// PROFILE_UA：协议 profile 固定 Chrome/150，与 JS 垫片 navigator 一致
static PROFILE_UA: OnceLock<String> = OnceLock::new();
fn profile_ua() -> &'static str {
    PROFILE_UA.get_or_init(|| ProtocolProfile::load().map(|p| p.user_agent).unwrap_or_default())
}

// ---------------------------------------------------------------------------
// 流程 1：ttwid（aid=10006 / sso.douyin.com + redirect_url 回调）
// ---------------------------------------------------------------------------

async fn bootstrap_ttwid(http: &wreq::Client, cookie_slot: &Mutex<Vec<(String, String)>>) -> Result<(), String> {
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

// ---------------------------------------------------------------------------
// 流程 2：get_qrcode
// ---------------------------------------------------------------------------

fn qrcode_query(profile: &ProtocolProfile, source_info: &str, trace_id: &str, ms_token: &str) -> Vec<(String, String)> {
    let p_ts = now_ms().to_string();
    let mut pairs: Vec<(String, String)> = vec![
        ("passport_jssdk_version".into(), profile.passport_jssdk_version.clone()),
        ("passport_jssdk_type".into(), "normal".into()),
        ("is_from_ttaccountsdk".into(), "1".into()),
        ("aid".into(), profile.aid.clone()),
        ("language".into(), "zh".into()),
        ("account_app_language".into(), "zh-CN".into()),
        ("next".into(), NEXT_URL.into()),
        ("need_short_url".into(), "true".into()),
        ("need_logo".into(), "false".into()),
        ("is_new_login".into(), "1".into()),
        ("is_from_iesaccountsaas".into(), "1".into()),
        ("p_ui".into(), profile.p_ui.clone()),
        ("account_sdk_source".into(), "web".into()),
        ("account_sdk_source_info".into(), source_info.into()),
        ("p_js_v".into(), profile.passport_jssdk_version.clone()),
        ("p_js_t".into(), "pro".into()),
        ("p_zt".into(), profile.p_zt.clone()),
        ("p_ver".into(), profile.p_ver.clone()),
        ("p_ver_real".into(), "0".into()),
        ("request_host".into(), "https%3A%2F%2Fwww.douyin.com".into()),
        ("p_bd".into(), profile.p_bd.clone()),
        ("p_ts".into(), p_ts.clone()),
        ("p_no".into(), p_no(profile, &p_ts, "0")),
        ("biz_trace_id".into(), trace_id.into()),
    ];
    if !ms_token.is_empty() {
        pairs.push(("msToken".into(), ms_token.into()));
    }
    pairs
}

// ---------------------------------------------------------------------------
// 流程 3：check 参数（query + body）
// ---------------------------------------------------------------------------

fn check_pairs(
    profile: &ProtocolProfile,
    session: &DouyinWebSession,
    verification: Option<&[(String, String)]>,
) -> (Vec<(String, String)>, Vec<(String, String)>) {
    let p_ts = now_ms().to_string();
    let mut pairs: Vec<(String, String)> = vec![
        ("passport_jssdk_version".into(), profile.passport_jssdk_version.clone()),
        ("passport_jssdk_type".into(), "normal".into()),
        ("is_from_ttaccountsdk".into(), "1".into()),
        ("aid".into(), profile.aid.clone()),
        ("language".into(), "zh".into()),
        ("account_app_language".into(), "zh-CN".into()),
        ("is_from_iesaccountsaas".into(), "1".into()),
        ("p_ui".into(), profile.p_ui.clone()),
        ("p_ca".into(), profile.p_ca.clone()),
        ("p_ca_real".into(), profile.p_ca_real.clone()),
        ("fp".into(), session.verify_fp.clone()),
        ("verifyFp".into(), session.verify_fp.clone()),
        ("account_sdk_source".into(), "web".into()),
        ("account_sdk_source_info".into(), session.source_info.clone()),
        ("p_js_v".into(), profile.passport_jssdk_version.clone()),
        ("p_js_t".into(), "pro".into()),
        ("p_zt".into(), profile.p_zt.clone()),
        ("p_ver".into(), profile.p_ver.clone()),
        ("p_ver_real".into(), "0".into()),
        ("request_host".into(), "https%3A%2F%2Fwww.douyin.com".into()),
        ("p_bd".into(), profile.p_bd.clone()),
        ("p_ts".into(), p_ts.clone()),
        ("p_no".into(), p_no(profile, &p_ts, &profile.p_ca)),
        ("biz_trace_id".into(), session.trace_id.clone()),
        ("is_new_login".into(), "1".into()),
    ];
    if !session.ms_token.is_empty() {
        pairs.push(("msToken".into(), session.ms_token.clone()));
    }

    let mut body: Vec<(String, String)> = vec![
        ("need_logo".into(), "false".into()),
        ("is_frontier".into(), session.frontier.to_string()),
        ("token".into(), session.token.clone()),
        ("is_new_login".into(), "1".into()),
        ("next".into(), NEXT_URL.into()),
        ("need_short_url".into(), "true".into()),
    ];
    if let Some(extra) = verification {
        body.extend(extra.iter().cloned());
    }
    (pairs, body)
}

// ---------------------------------------------------------------------------
// 对外入口：start
// ---------------------------------------------------------------------------

/// 完整取码 + 安全上下文握手。成功返回（二维码 data URI, 会话上下文）
pub async fn start(
    http: &wreq::Client,
    cookie_slot: &Mutex<Vec<(String, String)>>,
) -> Result<(String, DouyinWebSession), String> {
    let profile = ProtocolProfile::load()?;

    // 1) ttwid（已有则跳过，避免重复消耗额度）
    if cookie_value(cookie_slot, "ttwid")?.is_empty() {
        bootstrap_ttwid(http, cookie_slot).await?;
    }

    let trace_id = uuid_v4().replace('-', "").chars().take(8).collect::<String>();
    let source_info = encode_source_info();
    let verify_fp = make_verify_fp();

    // 2) get_qrcode
    let query = qrcode_query(&profile, &source_info, &trace_id, "");
    let query_string = encode_pairs(&query);
    let sign_target = format!("{GET_QR_URL}?{query_string}");
    let a_bogus = sign_a_bogus(sign_target.clone(), "GET".into(), String::new(), profile.user_agent.clone()).await?;
    let full_url = format!("{sign_target}&a_bogus={}", q_escape(&a_bogus));

    let resp = passport_request(http, cookie_slot, wreq::Method::GET, &full_url, None, &[], None).await?;
    let data = response_data(&resp.payload)?;
    let frontier = data.get("is_frontier").and_then(Value::as_bool).unwrap_or(false);
    if !frontier {
        return Err("get_qrcode 未进入 frontier 登录流程".into());
    }
    let token = data.get("token").and_then(Value::as_str).unwrap_or_default().to_string();
    if token.is_empty() {
        return Err("get_qrcode 响应缺少 token".into());
    }
    let qr_b64 = data.get("qrcode").and_then(Value::as_str).unwrap_or_default();
    let qr_png = BASE64_STANDARD.decode(qr_b64).map_err(|_| "get_qrcode 二维码不是合法 base64")?;
    if !qr_png.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("get_qrcode 二维码不是 PNG 图片".into());
    }
    let qr_data_uri = format!("data:image/png;base64,{qr_b64}");
    let ms_token = resp.ms_token;

    let mut session = DouyinWebSession {
        token,
        frontier,
        ms_token,
        trace_id,
        source_info,
        verify_fp,
        security_headers: Vec::new(),
        pending_verify: None,
        verification: Vec::new(),
    };

    // 3) ticket_guard/get_client_cert
    let cert_query: Vec<(String, String)> = vec![
        ("aid".into(), profile.aid.clone()),
        ("type".into(), "trait".into()),
        ("sdk_version".into(), profile.dtrait_container_version.clone()),
        ("is_from_ttaccountsdk".into(), "1".into()),
    ];
    let cert_body: Vec<(String, String)> = vec![("server_data".into(), "1".into()), ("need_session_dtrait".into(), "1".into())];
    let cert_body_string = encode_pairs(&cert_body);
    let cert_target = format!("{DTRAIT_CERT_URL}?{}", encode_pairs(&cert_query));
    let cert_a_bogus = sign_a_bogus(cert_target.clone(), "POST".into(), cert_body_string.clone(), profile.user_agent.clone()).await?;
    let csrf = cookie_value(cookie_slot, "passport_csrf_token")?;
    let cert_headers = [("X-Tt-Passport-Csrf-Token".to_string(), csrf)];
    let cert_full = format!("{cert_target}&a_bogus={}", q_escape(&cert_a_bogus));
    let cert_resp = passport_request(
        http,
        cookie_slot,
        wreq::Method::POST,
        &cert_full,
        Some(&cert_body_string),
        &cert_headers,
        None,
    )
    .await?;
    let cert_data = response_data(&cert_resp.payload)?;

    // 服务端字符串参数全部透传给 DTrait（pk1/pk1-version/pk2/…/version）
    let mut server_params: HashMap<String, String> = HashMap::new();
    if let Some(map) = cert_data.as_object() {
        for (k, v) in map {
            if let Some(text) = v.as_str() {
                server_params.insert(k.clone(), text.to_string());
            }
        }
    }

    // 4) DTrait 安全头（按 check 请求的 query/body 签名；整轮轮询复用这一组头）
    let (dtrait_query, dtrait_body) = check_pairs(&profile, &session, None);
    let dtrait_target = format!("{CHECK_QR_URL}?{}", encode_pairs(&dtrait_query));
    let dtrait_body_string = encode_pairs(&dtrait_body);
    let security = build_dtrait_headers(dtrait_target, dtrait_body_string, profile.user_agent.clone(), server_params).await?;
    let mut security_headers: Vec<(String, String)> = security.into_iter().collect();
    security_headers.sort_by(|a, b| a.0.cmp(&b.0));
    if !security_headers.iter().any(|(k, v)| k == "x-tt-session-dtrait" && v.starts_with("d1_")) {
        return Err("DTrait 未返回 d1_ 会话安全头".into());
    }
    session.security_headers = security_headers;

    Ok((qr_data_uri, session))
}

// ---------------------------------------------------------------------------
// 对外入口：poll
// ---------------------------------------------------------------------------

pub async fn poll(
    http: &wreq::Client,
    cookie_slot: &Mutex<Vec<(String, String)>>,
    session: &mut DouyinWebSession,
) -> Result<PollOutcome, String> {
    let profile = ProtocolProfile::load()?;
    let verification = if session.verification.is_empty() { None } else { Some(session.verification.as_slice()) };
    let (query, body) = check_pairs(&profile, session, verification);
    let body_string = encode_pairs(&body);
    let query_string = encode_pairs(&query);
    let sign_target = format!("{CHECK_QR_URL}?{query_string}");
    let a_bogus = sign_a_bogus(sign_target.clone(), "POST".into(), body_string.clone(), profile.user_agent.clone()).await?;
    let full_url = format!("{sign_target}&a_bogus={}", q_escape(&a_bogus));

    let csrf = cookie_value(cookie_slot, "passport_csrf_token")?;
    let mut headers = session.security_headers.clone();
    headers.push(("X-Tt-Passport-Csrf-Token".into(), csrf));
    headers.push(("X-Tt-Passport-Trace-Id".into(), session.trace_id.clone()));

    let resp = passport_request(http, cookie_slot, wreq::Method::POST, &full_url, Some(&body_string), &headers, None).await;
    let data = match resp.and_then(|r| response_data(&r.payload).map(|data| (r, data))) {
        Ok((resp, data)) => {
            // 服务端 msToken 轮换（仅成功响应）
            if !resp.ms_token.is_empty() {
                session.ms_token = resp.ms_token;
            }
            data
        }
        Err(err) => {
            if let Some(api) = parse_api_error(&err) {
                if api.code == 7 {
                    return Ok(PollOutcome::RateLimited);
                }
                // 2046 + account_flow=verify：进入扫码 MFA（自动发送短信验证码）
                if api.code == 2046
                    && session.verification.is_empty()
                    && session.pending_verify.is_none()
                    && api.data.get("account_flow").and_then(Value::as_str) == Some("verify")
                {
                    session.pending_verify = Some(api.data.clone());
                    // 账号提供 mobile_sms_verify 方式：自动发送首条短信，进入短信 MFA
                    if mfa_sms_way(&api.data).is_some() {
                        let mobile = match mfa_send(http, cookie_slot, session).await {
                            Ok(mobile) => mobile,
                            Err(send_err) => {
                                eprintln!("[douyin] 2046 自动发送短信失败: {send_err}");
                                None
                            }
                        };
                        return Ok(PollOutcome::VerificationRequired { mobile });
                    }
                    // 账号没有手机短信二次验证（如仅人脸/运营商短信验证）：
                    // 桌面端无法完成，给出引导提示，不再展示必然失败的短信输入框
                    eprintln!(
                        "[douyin] 2046 未提供 mobile_sms_verify，verify_ways: {}",
                        api.data.get("verify_ways").cloned().unwrap_or(Value::Null)
                    );
                    return Ok(PollOutcome::VerificationUnsupported {
                        message: mfa_unsupported_message(&api.data),
                    });
                }
                return Err(format!("{} ({})", api.desc, api.code));
            }
            return Err(err);
        }
    };

    // status 可能是数字或字符串；Go 用 fmt.Sprint 再去掉 ".0"
    let mut status = match data.get("status") {
        Some(Value::String(s)) => s.clone(),
        Some(other) => other.to_string().trim_end_matches(".0").to_string(),
        None => "new".into(),
    };
    if status == "1" {
        status = "new".into();
    } else if status == "2" {
        status = "scanned".into();
    } else if status == "3" {
        status = "confirmed".into();
    } else if status == "5" {
        status = "expired".into();
    }

    match status.as_str() {
        "new" => Ok(PollOutcome::Waiting),
        "scanned" => Ok(PollOutcome::Scanned),
        "expired" => Ok(PollOutcome::Expired),
        "4" => {
            // 无感换码：新 token + 内嵌新二维码
            let new_token = data.get("token").and_then(Value::as_str).unwrap_or_default().to_string();
            let qr_b64 = data.get("qrcode").and_then(Value::as_str).unwrap_or_default();
            if new_token.is_empty() || qr_b64.is_empty() {
                return Err("换码响应缺少 token/二维码".into());
            }
            session.token = new_token;
            let qr_data_uri = if qr_b64.starts_with("data:image") {
                qr_b64.to_string()
            } else {
                format!("data:image/png;base64,{qr_b64}")
            };
            Ok(PollOutcome::Refreshed { qr_data_uri })
        }
        "confirmed" => {
            // 跟随 redirect_url 完成登录票据 Set-Cookie 落地
            if let Some(redirect) = data.get("redirect_url").and_then(Value::as_str).filter(|s| !s.is_empty()) {
                follow_with_cookies(http, cookie_slot, redirect).await?;
            }
            let (uid, name) = fetch_self(http, cookie_slot, &profile).await?;
            let cookie = cookie_header(cookie_slot)?;
            Ok(PollOutcome::Confirmed { uid, name, cookie })
        }
        other => Err(format!("未知的扫码状态: {other}")),
    }
}

/// confirmed 后拉 self profile 校验登录态并取 uid/昵称
async fn fetch_self(
    http: &wreq::Client,
    cookie_slot: &Mutex<Vec<(String, String)>>,
    profile: &ProtocolProfile,
) -> Result<(Option<String>, Option<String>), String> {
    let query: Vec<(String, String)> = vec![
        ("device_platform".into(), "webapp".into()),
        ("aid".into(), profile.aid.clone()),
        ("channel".into(), "channel_pc_web".into()),
        ("publish_video_strategy_type".into(), "2".into()),
        ("source".into(), "channel_pc_web".into()),
    ];
    let target = format!("{SELF_PROFILE_URL}?{}", encode_pairs(&query));
    let a_bogus = sign_a_bogus(target.clone(), "GET".into(), String::new(), profile.user_agent.clone()).await?;
    let full_url = format!("{target}&a_bogus={}", q_escape(&a_bogus));
    let resp = passport_request(http, cookie_slot, wreq::Method::GET, &full_url, None, &[], Some("https://www.douyin.com/user/self")).await?;
    let payload = resp.payload;
    let status_code = payload.get("status_code").and_then(Value::as_i64).unwrap_or(-1);
    if status_code != 0 {
        let msg = payload.get("status_msg").and_then(Value::as_str).unwrap_or("").to_string();
        return Err(format!("self profile 校验失败: {msg} ({status_code})"));
    }
    let user = payload.get("user").ok_or("self profile 未返回 user")?;
    let uid = ["uid", "user_id_str", "user_id", "short_id"]
        .iter()
        .find_map(|k| user.get(*k).map(|v| v.to_string().trim_matches('"').to_string()))
        .filter(|s| !s.is_empty());
    let name = ["nickname", "screen_name", "name"]
        .iter()
        .find_map(|k| user.get(*k).and_then(Value::as_str).map(str::to_string));
    Ok((uid, name))
}

// ---------------------------------------------------------------------------
// 扫码二次验证（error 2046 → 短信 MFA）
// ---------------------------------------------------------------------------

const MFA_SEND_URL: &str = "https://login.douyin.com/passport/web/send_code/";
const MFA_VALIDATE_URL: &str = "https://login.douyin.com/passport/web/validate_code/";
const MFA_SDK_VERSION: &str = "1.0.0.413";
const MFA_PASSPORT_VERSION: &str = "5.1.2";

/// 从 2046 data 中找 mobile_sms_verify 验证方式
fn mfa_sms_way(data: &Value) -> Option<&Value> {
    data.get("verify_ways")?
        .as_array()?
        .iter()
        .find(|way| way.get("verify_way").and_then(Value::as_str) == Some("mobile_sms_verify"))
}

/// 2046 验证方式标识 → 中文名（未知方式保留原始标识）
fn verify_way_label(way: &Value) -> Option<String> {
    let raw = way.get("verify_way").and_then(Value::as_str)?;
    let label = match raw {
        "mobile_sms_verify" => "手机短信验证",
        "mobile_up_sms_verify" => "本机号码短信验证",
        "face_verify" => "人脸验证",
        other => return Some(other.to_string()),
    };
    Some(label.to_string())
}

/// 账号没有手机短信二次验证时的前端引导文案（服务端 description 语义与此重复，不直接拼接）
fn mfa_unsupported_message(data: &Value) -> String {
    let labels: Vec<String> = data
        .get("verify_ways")
        .and_then(Value::as_array)
        .map(|ways| ways.iter().filter_map(verify_way_label).collect())
        .unwrap_or_default();
    let action = if labels.is_empty() {
        "请前往抖音 App 完成身份验证后，重新扫码登录。".to_string()
    } else {
        format!("请在抖音 App 中通过「{}」完成身份验证后，重新扫码登录。", labels.join("、"))
    };
    format!("该账号未开启手机短信二次验证，无法在此输入短信验证码。{action}")
}

/// 构建 MFA 表单（Go url.Values.Encode 按 key 字典序输出，这里同样排序）
fn build_mfa_body(profile: &ProtocolProfile, data: &Value, code: Option<&str>) -> Result<Vec<(String, String)>, String> {
    let way = mfa_sms_way(data).ok_or_else(|| "二次验证未提供短信验证方式".to_string())?;
    let mut pairs: Vec<(String, String)> = Vec::new();
    let encrypt_uid = data.get("encrypt_uid").and_then(Value::as_str).unwrap_or("").to_string();
    let verify_ticket = data.get("verify_ticket").and_then(Value::as_str).unwrap_or("").to_string();
    pairs.push(("encrypt_uid".into(), encrypt_uid));
    pairs.push(("verify_ticket".into(), verify_ticket));
    if let Some(common) = data.get("common_params").and_then(Value::as_object) {
        for (k, v) in common {
            let value = v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string());
            pairs.push((k.clone(), value));
        }
    }
    let act_raw = way
        .get("act_type")
        .map(|v| v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string()))
        .unwrap_or_default();
    let act_trimmed = act_raw.strip_suffix(".0").unwrap_or(&act_raw);
    let act_type = if act_trimmed.is_empty() { "22" } else { act_trimmed };
    pairs.push(("type".into(), xor5_hex(act_type.as_bytes())));
    pairs.push(("aid".into(), profile.aid.clone()));
    pairs.push(("std_verify_way".into(), "mobile_sms_verify".into()));
    pairs.push(("new_authn_sdk_version".into(), MFA_SDK_VERSION.into()));
    pairs.push(("mix_mode".into(), "1".into()));
    if let Some(code) = code {
        pairs.push(("code".into(), xor5_hex(code.as_bytes())));
    }
    pairs.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(pairs)
}

async fn mfa_request(
    http: &wreq::Client,
    cookie_slot: &Mutex<Vec<(String, String)>>,
    endpoint: &str,
    body: &[(String, String)],
) -> Result<Value, String> {
    let profile = ProtocolProfile::load()?;
    // MFA 请求用 lite 版 passport 参数且不带 a_bogus（与参考实现一致）
    let query: Vec<(String, String)> = vec![
        ("passport_jssdk_version".into(), MFA_PASSPORT_VERSION.into()),
        ("passport_jssdk_type".into(), "lite".into()),
        ("is_from_ttaccountsdk".into(), "1".into()),
        ("aid".into(), profile.aid),
        ("language".into(), "zh".into()),
        ("account_app_language".into(), "zh-CN".into()),
        ("new_authn_sdk_version".into(), MFA_SDK_VERSION.into()),
    ];
    let full_url = format!("{endpoint}?{}", encode_pairs(&query));
    let resp = passport_request(http, cookie_slot, wreq::Method::POST, &full_url, Some(&encode_pairs(body)), &[], None).await?;
    response_data(&resp.payload)
}

/// 发送扫码二次验证短信（pending_verify 由 poll 遇到 2046 时写入）
pub async fn mfa_send(
    http: &wreq::Client,
    cookie_slot: &Mutex<Vec<(String, String)>>,
    session: &mut DouyinWebSession,
) -> Result<Option<String>, String> {
    let data = session.pending_verify.clone().ok_or_else(|| "没有待完成的二次验证".to_string())?;
    let profile = ProtocolProfile::load()?;
    let body = build_mfa_body(&profile, &data, None)?;
    mfa_request(http, cookie_slot, MFA_SEND_URL, &body).await?;
    let mobile = mfa_sms_way(&data)
        .and_then(|way| way.get("mobile").and_then(Value::as_str))
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    Ok(mobile)
}

/// 校验扫码二次验证短信：成功后写入 verify_ticket，后续 check 请求体自动上送
pub async fn mfa_validate(
    http: &wreq::Client,
    cookie_slot: &Mutex<Vec<(String, String)>>,
    session: &mut DouyinWebSession,
    code: &str,
) -> Result<(), String> {
    let code = code.trim();
    if code.len() != 6 || !code.bytes().all(|b| b.is_ascii_digit()) {
        return Err("请输入 6 位数字短信验证码".into());
    }
    let data = session.pending_verify.clone().ok_or_else(|| "没有待完成的二次验证".to_string())?;
    let profile = ProtocolProfile::load()?;
    let body = build_mfa_body(&profile, &data, Some(code))?;
    let result = mfa_request(http, cookie_slot, MFA_VALIDATE_URL, &body).await?;
    // response_data 已剥离外层 data，ticket 直接在顶层
    let ticket = result
        .get("ticket")
        .and_then(Value::as_str)
        .ok_or_else(|| "短信验证响应未返回 verify ticket".to_string())?;
    session.verification = vec![
        ("verify_ticket".into(), ticket.to_string()),
        ("std_verify_way".into(), "mobile_sms_verify".into()),
    ];
    session.pending_verify = None;
    Ok(())
}
