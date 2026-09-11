//! 抖音 web 安全栈（bdms a_bogus 签名 + DTrait 设备指纹）。
//!
//! 用 QuickJS（rquickjs）承载官方 `bdms.1.0.1.20.js` / `dtrait-core.1.0.29.js`，
//! Rust 侧提供与参考 Go 实现一致的最小浏览器垫片宿主能力（定时器、URL、base64、
//! SHA-256、AES-CBC、RSA/PKCS1、P-256 ECDH、raw deflate 等）。
//!
//! 移植自 Caviar9/douyin-web-qr-login（Go/goja），对应关系：
//! signer.go 的 goja_nodejs eventloop → runtime.rs 的 setTimeout 表驱动循环；
//! signer_runtime.js 原样内嵌，不做改动。
//!
//! - [`runtime`]：QuickJS 引擎生命周期、表驱动事件循环与 JS 宿主绑定
//! - [`crypto`]：绑定函数背后的原生算法实现（URL/deflate/AES/RSA/ECDH）

mod crypto;
mod runtime;

use std::collections::HashMap;
use std::time::Duration;

use runtime::run;

const BDMS_SOURCE: &str = include_str!("../../resources/douyin/bdms.1.0.1.20.js");
const DTRAIT_SOURCE: &str = include_str!("../../resources/douyin/dtrait-core.1.0.29.js");
const DTRAIT_PARAMS: &str = include_str!("../../resources/douyin/dtrait-params.json");
const RUNTIME_JS: &str = include_str!("../../resources/douyin/signer_runtime.js");

/// sign 模式 8s / dtrait 模式 12s，与参考实现一致。
const SIGN_TIMEOUT: Duration = Duration::from_secs(8);
const DTRAIT_TIMEOUT: Duration = Duration::from_secs(12);

/// 让 bdms 给请求 URL 注入 a_bogus，返回签名值（≥180 字符）。
pub fn sign(target_url: &str, method: &str, body: &str, user_agent: &str) -> Result<String, String> {
    let mut result = run("sign", target_url, method, body, user_agent, None, SIGN_TIMEOUT)?;
    let value = result.remove("a_bogus").unwrap_or_default();
    if value.len() < 180 {
        return Err(format!("unexpected a_bogus length: {}", value.len()));
    }
    Ok(value)
}

/// 运行 DTrait SDK，产出 check_qrconnect 所需的 5 个安全请求头。
pub fn dtrait_headers(
    target_url: &str,
    method: &str,
    body: &str,
    user_agent: &str,
    server_params: &HashMap<String, String>,
) -> Result<HashMap<String, String>, String> {
    run(
        "dtrait",
        target_url,
        method,
        body,
        user_agent,
        Some(server_params),
        DTRAIT_TIMEOUT,
    )
}
