//! 抖音 web 协议参数的纯函数工具：随机标识、URL 编码、指纹摘要。
//!
//! 全部为无 IO 的确定性/随机计算，供 start/poll 与 MFA 流程共用。

use std::time::{SystemTime, UNIX_EPOCH};

use sha2::{Digest, Sha256};

use super::NEXT_URL;

pub(super) fn now_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or_default()
}

pub(super) fn random_hex(byte_len: usize) -> String {
    use rand::RngCore;
    let mut bytes = vec![0u8; byte_len];
    rand::rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// UUID v4 风格（无连字符时另行替换）
pub(super) fn uuid_v4() -> String {
    use rand::Rng;
    let mut hex = random_hex(16);
    hex.replace_range(12..13, "4");
    let variant = b"89ab"[rand::rng().random_range(0..4)] as char;
    hex.replace_range(16..17, &variant.to_string());
    format!("{}-{}-{}-{}-{}", &hex[0..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..32])
}

pub(super) fn random_digits(len: usize) -> String {
    use rand::Rng;
    (0..len).map(|_| char::from(b'0' + rand::rng().random_range(0..10))).collect()
}

/// Go url.QueryEscape：字母数字与 -_.~ 不转义，空格 → +，其余字节 %XX（大写）
pub(super) fn q_escape(input: &str) -> String {
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

pub(super) fn encode_pairs(pairs: &[(String, String)]) -> String {
    pairs.iter().map(|(k, v)| format!("{}={}", q_escape(k), q_escape(v))).collect::<Vec<_>>().join("&")
}

/// p_no：passport SDK 版本参数的 SHA256 摘要（键名字典序，& 连接）
/// get_qrcode 时 pca 传 "0"，check 时传 profile.p_ca
pub(super) fn p_no(profile: &super::ProtocolProfile, p_ts: &str, pca: &str) -> String {
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

pub(super) fn xor5_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b ^ 5)).collect()
}

/// account_sdk_source_info：环境指纹 JSON 逐字节 XOR 5 后十六进制
/// 字段集合与 Go 参考一致；serde_json 默认 BTreeMap 保证键名字典序，
/// 与 Go encoding/json 对 map 的输出顺序一致。
pub(super) fn encode_source_info() -> String {
    let cpu = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(8);
    let source = serde_json::json!({
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

pub(super) fn make_verify_fp() -> String {
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
