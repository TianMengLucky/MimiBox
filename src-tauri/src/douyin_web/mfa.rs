//! 扫码二次验证（error 2046 → 短信 MFA）。
//!
//! MFA 请求使用 lite 版 passport 参数且不带 a_bogus（与参考 Go 实现一致）；
//! type/code 字段用 xor5 加密。验证成功后把 verify_ticket 写入会话，
//! 后续 check 请求体自动上送。

use std::sync::Mutex;

use serde_json::Value;

use super::http::passport_request;
use super::params::{encode_pairs, xor5_hex};
use super::{response_data, DouyinWebSession, ProtocolProfile};

const MFA_SEND_URL: &str = "https://login.douyin.com/passport/web/send_code/";
const MFA_VALIDATE_URL: &str = "https://login.douyin.com/passport/web/validate_code/";
const MFA_SDK_VERSION: &str = "1.0.0.413";
const MFA_PASSPORT_VERSION: &str = "5.1.2";

/// 支持的短信验证方式（真机 2046 响应实测标识），按优先级排序：
/// 主手机号短信 → 主手机号发送短信 → 辅助手机短信 → 辅助手机发送短信
const SMS_VERIFY_WAYS: &[&str] = &[
    "mobile_sms_verify",
    "mobile_up_sms_verify",
    "assist_mobile_sms_verify",
    "assist_mobile_up_sms_verify",
];

/// 从 2046 data 中挑选短信验证方式：按 [`SMS_VERIFY_WAYS`] 优先级取第一个可用项
pub(super) fn mfa_sms_way(data: &Value) -> Option<&Value> {
    let ways = data.get("verify_ways")?.as_array()?;
    SMS_VERIFY_WAYS.iter().find_map(|preferred| {
        ways.iter().find(|way| way.get("verify_way").and_then(Value::as_str) == Some(*preferred))
    })
}

/// 2046 验证方式标识 → 中文名（未知方式保留原始标识）
fn verify_way_label(way: &Value) -> Option<String> {
    let raw = way.get("verify_way").and_then(Value::as_str)?;
    let label = match raw {
        "mobile_sms_verify" => "手机短信验证",
        "mobile_up_sms_verify" => "手机发送短信验证",
        "assist_mobile_sms_verify" => "辅助手机短信验证",
        "assist_mobile_up_sms_verify" => "辅助手机发送短信验证",
        "face_verify" => "人脸验证",
        other => return Some(other.to_string()),
    };
    Some(label.to_string())
}

/// 账号没有手机短信二次验证时的前端引导文案（服务端 description 语义与此重复，不直接拼接）
pub(super) fn mfa_unsupported_message(data: &Value) -> String {
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
    // 上送实际选择的验证方式（主/辅助手机号各自不同）
    let std_verify_way = way
        .get("verify_way")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .unwrap_or("mobile_sms_verify")
        .to_string();
    pairs.push(("std_verify_way".into(), std_verify_way));
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
    let std_verify_way = mfa_sms_way(&data)
        .and_then(|way| way.get("verify_way").and_then(Value::as_str))
        .filter(|s| !s.is_empty())
        .unwrap_or("mobile_sms_verify")
        .to_string();
    session.verification = vec![
        ("verify_ticket".into(), ticket.to_string()),
        ("std_verify_way".into(), std_verify_way),
    ];
    session.pending_verify = None;
    Ok(())
}
