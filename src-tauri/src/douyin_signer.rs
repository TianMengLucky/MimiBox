//! 抖音 web 安全栈（bdms a_bogus 签名 + DTrait 设备指纹）。
//!
//! 用 QuickJS（rquickjs）承载官方 `bdms.1.0.1.20.js` / `dtrait-core.1.0.29.js`，
//! Rust 侧提供与参考 Go 实现一致的最小浏览器垫片宿主能力（定时器、URL、base64、
//! SHA-256、AES-CBC、RSA/PKCS1、P-256 ECDH、raw deflate 等）。
//!
//! 移植自 Caviar9/douyin-web-qr-login（Go/goja），对应关系：
//! signer.go 的 goja_nodejs eventloop → 本模块的 setTimeout 表驱动循环；
//! signer_runtime.js 原样内嵌，不做改动。

use std::collections::{BTreeMap, HashMap};
use std::io::Read as _;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use base64::engine::general_purpose::{STANDARD, STANDARD_NO_PAD};
use base64::Engine as _;
use flate2::read::DeflateDecoder;
use rand::RngCore as _;
use rquickjs::{Context, Ctx, Function, IntoJs, Persistent, Runtime};
use sha2::{Digest as _, Sha256};

const BDMS_SOURCE: &str = include_str!("../resources/douyin/bdms.1.0.1.20.js");
const DTRAIT_SOURCE: &str = include_str!("../resources/douyin/dtrait-core.1.0.29.js");
const DTRAIT_PARAMS: &str = include_str!("../resources/douyin/dtrait-params.json");
const RUNTIME_JS: &str = include_str!("../resources/douyin/signer_runtime.js");

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

enum Outcome {
    Emit(HashMap<String, String>),
    Fail(String),
}

struct TimerEntry {
    deadline: Instant,
    /// Some = setInterval 的周期（毫秒），None = setTimeout 单次。
    period: Option<u64>,
    callback: Persistent<Function<'static>>,
}

struct Inner {
    outcome: Option<Outcome>,
    phase: String,
    rejections: Vec<String>,
    timers: BTreeMap<u64, TimerEntry>,
    next_timer_id: u64,
    start: Instant,
}

fn run(
    mode: &str,
    target_url: &str,
    method: &str,
    body: &str,
    user_agent: &str,
    server_params: Option<&HashMap<String, String>>,
    timeout: Duration,
) -> Result<HashMap<String, String>, String> {
    let rt = Runtime::new().map_err(|e| format!("创建 QuickJS Runtime 失败: {e}"))?;
    let ctx = Context::full(&rt).map_err(|e| format!("创建 QuickJS Context 失败: {e}"))?;

    let inner = Arc::new(Mutex::new(Inner {
        outcome: None,
        phase: "starting".into(),
        rejections: Vec::new(),
        timers: BTreeMap::new(),
        next_timer_id: 1,
        start: Instant::now(),
    }));

    // Promise reject 追踪（dtrait 失败诊断要用，等价 goja SetPromiseRejectionTracker）。
    {
        let rej = inner.clone();
        rt.set_host_promise_rejection_tracker(Some(Box::new(move |_ctx, _promise, reason, handled| {
            if handled {
                return;
            }
            let msg = reason
                .as_string()
                .and_then(|s| s.to_string().ok())
                .unwrap_or_else(|| "<unknown rejection>".into());
            if let Ok(mut g) = rej.lock() {
                if g.rejections.len() < 8 {
                    g.rejections.push(msg);
                }
            }
        })));
    }

    let config = serde_json::json!({
        "mode": mode,
        "targetUrl": target_url,
        "method": method,
        "body": body,
        "userAgent": user_agent,
        "serverParams": server_params.cloned().unwrap_or_default(),
    });
    let config_raw = config.to_string();

    let setup: Result<(), String> = ctx.with(|ctx| {
        let globals = ctx.globals();

        globals.set("__configRaw", config_raw).map_err(|e| e.to_string())?;
        globals.set("__bdmsSource", BDMS_SOURCE).map_err(|e| e.to_string())?;
        globals.set("__dtraitSource", DTRAIT_SOURCE).map_err(|e| e.to_string())?;
        globals.set("__dtraitParams", DTRAIT_PARAMS).map_err(|e| e.to_string())?;

        // __emit / __fail / __phase / __promiseRejections / __performanceNow
        {
            let inner = inner.clone();
            globals
                .set(
                    "__emit",
                    Function::new(ctx.clone(), move |raw: String| {
                        match serde_json::from_str::<HashMap<String, String>>(&raw) {
                            Ok(map) => {
                                if let Ok(mut g) = inner.lock() {
                                    g.outcome = Some(Outcome::Emit(map));
                                }
                            }
                            Err(e) => {
                                if let Ok(mut g) = inner.lock() {
                                    g.outcome = Some(Outcome::Fail(format!("decode signer result: {e}")));
                                }
                            }
                        }
                    }),
                )
                .map_err(|e| e.to_string())?;
        }
        {
            let inner = inner.clone();
            globals
                .set(
                    "__fail",
                    Function::new(ctx.clone(), move |message: String| {
                        if let Ok(mut g) = inner.lock() {
                            g.outcome = Some(Outcome::Fail(message));
                        }
                    }),
                )
                .map_err(|e| e.to_string())?;
        }
        {
            let inner = inner.clone();
            globals
                .set(
                    "__phase",
                    Function::new(ctx.clone(), move |value: String| {
                        if let Ok(mut g) = inner.lock() {
                            g.phase = value;
                        }
                    }),
                )
                .map_err(|e| e.to_string())?;
        }
        {
            let inner = inner.clone();
            globals
                .set(
                    "__promiseRejections",
                    Function::new(ctx.clone(), move || -> String {
                        inner
                            .lock()
                            .map(|g| g.rejections.join(" | "))
                            .unwrap_or_default()
                    }),
                )
                .map_err(|e| e.to_string())?;
        }
        {
            let inner = inner.clone();
            globals
                .set(
                    "__performanceNow",
                    Function::new(ctx.clone(), move || -> f64 {
                        inner
                            .lock()
                            .map(|g| g.start.elapsed().as_micros() as f64 / 1000.0)
                            .unwrap_or(0.0)
                    }),
                )
                .map_err(|e| e.to_string())?;
        }

        // 随机数 / 编码 / 加密等纯函数绑定。
        register_simple_bindings(&ctx, &globals)?;

        // 定时器（goja_nodejs/eventloop 由宿主提供 setTimeout，这里自己实现）。
        globals
            .set("setTimeout", Function::new(ctx.clone(), make_timer_registrar(inner.clone(), false)))
            .map_err(|e| e.to_string())?;
        globals
            .set("setInterval", Function::new(ctx.clone(), make_timer_registrar(inner.clone(), true)))
            .map_err(|e| e.to_string())?;
        globals
            .set(
                "clearTimeout",
                Function::new(ctx.clone(), {
                    let timers = inner.clone();
                    move |id: f64| {
                        if let Ok(mut g) = timers.lock() {
                            g.timers.remove(&(id as u64));
                        }
                    }
                }),
            )
            .map_err(|e| e.to_string())?;
        globals
            .set(
                "clearInterval",
                Function::new(ctx.clone(), {
                    let timers = inner.clone();
                    move |id: f64| {
                        if let Ok(mut g) = timers.lock() {
                            g.timers.remove(&(id as u64));
                        }
                    }
                }),
            )
            .map_err(|e| e.to_string())?;

        // 前奏：解析 config；提供 goja eventloop 默认存在的 console / structuredClone。
        ctx.eval::<(), _>(
            r#"
globalThis.__config = JSON.parse(__configRaw);
if (typeof globalThis.console === "undefined") {
  globalThis.console = { log(){}, info(){}, warn(){}, error(){}, debug(){}, trace(){} };
}
if (typeof globalThis.structuredClone === "undefined") {
  globalThis.structuredClone = v => JSON.parse(JSON.stringify(v));
}
"#,
        )
        .map_err(|e| format!("执行 signer 前奏失败: {e}"))?;

        ctx.eval::<(), _>(RUNTIME_JS)
            .map_err(|e| format!("run signer: {e}"))?;
        Ok(())
    });
    if let Err(message) = setup {
        if let Ok(mut g) = inner.lock() {
            g.timers.clear();
        }
        rt.run_gc();
        return Err(message);
    }

    // 事件循环必须在 Context::with 之外驱动：with 期间 Runtime 锁被持有，
    // execute_pending_job 会重入加锁（sign 模式同步 emit，在首个检查点即返回）。
    let result = drive_event_loop(&rt, &ctx, &inner, timeout);

    // 无论成功失败都释放 Persistent 并 GC：DTrait SDK 有循环引用，QuickJS 在
    // FreeRuntime 时断言 gc_obj_list 为空，release panic=abort 下会直接崩进程。
    if let Ok(mut g) = inner.lock() {
        g.timers.clear();
    }
    rt.run_gc();
    result
}

fn make_timer_registrar(
    inner: Arc<Mutex<Inner>>,
    interval: bool,
) -> impl for<'js> Fn(Ctx<'js>, Function<'js>, Option<f64>) -> f64 + 'static {
    move |ctx: Ctx<'_>, callback: Function<'_>, ms: Option<f64>| {
        register_timer(&ctx, &inner, callback, ms, interval)
    }
}

fn register_timer<'js>(
    ctx: &Ctx<'js>,
    inner: &Arc<Mutex<Inner>>,
    callback: Function<'js>,
    ms: Option<f64>,
    interval: bool,
) -> f64 {
    let Ok(mut g) = inner.lock() else {
        return 0.0;
    };
    let id = g.next_timer_id;
    g.next_timer_id += 1;
    let delay = (ms.unwrap_or(0.0).max(0.0)) as u64;
    g.timers.insert(
        id,
        TimerEntry {
            deadline: Instant::now() + Duration::from_millis(delay),
            period: if interval { Some(delay.max(1)) } else { None },
            callback: Persistent::save(ctx, callback),
        },
    );
    id as f64
}

/// 排空 Promise 微任务 → 执行到期定时器，循环直到 __emit/__fail 或超时。
fn drive_event_loop(
    rt: &Runtime,
    ctx: &Context,
    inner: &Arc<Mutex<Inner>>,
    timeout: Duration,
) -> Result<HashMap<String, String>, String> {
    let start = Instant::now();
    loop {
        if let Some(outcome) = inner.lock().map_err(poison_err)?.outcome.take() {
            return match outcome {
                Outcome::Emit(map) => Ok(map),
                Outcome::Fail(message) => Err(message),
            };
        }

        // 排空全部 pending promise job。
        loop {
            match rt.execute_pending_job() {
                Ok(true) => continue,
                Ok(false) => break,
                Err(e) => return Err(format!("js job 异常: {e:?}")),
            }
        }

        if let Some(outcome) = inner.lock().map_err(poison_err)?.outcome.take() {
            return match outcome {
                Outcome::Emit(map) => Ok(map),
                Outcome::Fail(message) => Err(message),
            };
        }

        let now = Instant::now();
        if start.elapsed() >= timeout {
            let phase = inner.lock().map(|g| g.phase.clone()).unwrap_or_default();
            return Err(format!("signer timed out at {phase}"));
        }

        let due: Vec<u64> = inner
            .lock()
            .map_err(poison_err)?
            .timers
            .iter()
            .filter(|(_, entry)| entry.deadline <= now)
            .map(|(id, _)| *id)
            .collect();

        if due.is_empty() {
            let next_deadline = inner
                .lock()
                .map_err(poison_err)?
                .timers
                .values()
                .map(|entry| entry.deadline)
                .min();
            let wake = next_deadline.unwrap_or(start + timeout).min(start + timeout);
            if wake > now {
                thread::sleep(wake - now);
            }
            continue;
        }

        // restore 只借用 Persistent（&self），因此 interval 回调可保留在表里重排期，
        // timeout 回调恢复后从表中移除。
        let due: Vec<(u64, Option<u64>)> = {
            let g = inner.lock().map_err(poison_err)?;
            g.timers
                .iter()
                .filter(|(_, entry)| entry.deadline <= now)
                .map(|(id, entry)| (*id, entry.period))
                .collect()
        };
        let mut fired: Vec<Persistent<Function<'static>>> = Vec::with_capacity(due.len());
        {
            let mut g = inner.lock().map_err(poison_err)?;
            for (id, period) in due {
                match period {
                    Some(period_ms) => {
                        if let Some(entry) = g.timers.get(&id) {
                            fired.push(entry.callback.clone());
                        }
                        if let Some(entry) = g.timers.get_mut(&id) {
                            entry.deadline = Instant::now() + Duration::from_millis(period_ms);
                        }
                    }
                    None => {
                        if let Some(entry) = g.timers.remove(&id) {
                            fired.push(entry.callback);
                        }
                    }
                }
            }
        }
        for callback in fired {
            ctx.with(|ctx| -> Result<(), String> {
                let function = callback.restore(&ctx).map_err(|e| e.to_string())?;
                function.call::<_, ()>(()).map_err(|e| format!("定时器回调异常: {e}"))
            })?;
        }
    }
}

fn poison_err<T>(_: T) -> String {
    "signer 内部锁中毒".into()
}

/// 把 Rust 错误消息抛成 JS 异常（0.13 的 Ctx::throw 只接受具体 Value）。
fn throw_value<'js>(ctx: &Ctx<'js>, message: String) -> rquickjs::Error {
    match message.into_js(ctx) {
        Ok(value) => ctx.throw(value),
        Err(e) => e,
    }
}

/// 注册与 signer.go 一一对应的纯函数宿主绑定（自由函数天然满足 HRTB）。
fn register_simple_bindings<'js>(ctx: &Ctx<'js>, globals: &rquickjs::Object<'js>) -> Result<(), String> {
    // 自由函数必须显式标注类型才能作为函数指针传入 Function::new。
    globals.set("__parseURL", Function::new(ctx.clone(), b_parse_url)).map_err(|e| e.to_string())?;
    globals.set("__setURLQuery", Function::new(ctx.clone(), b_set_url_query)).map_err(|e| e.to_string())?;
    globals.set("__utf8Encode", Function::new(ctx.clone(), b_utf8_encode)).map_err(|e| e.to_string())?;
    globals.set("__utf8Decode", Function::new(ctx.clone(), b_utf8_decode)).map_err(|e| e.to_string())?;
    globals.set("__base64Encode", Function::new(ctx.clone(), b_base64_encode)).map_err(|e| e.to_string())?;
    globals.set("__base64Decode", Function::new(ctx.clone(), b_base64_decode)).map_err(|e| e.to_string())?;
    globals.set("__hexEncode", Function::new(ctx.clone(), b_hex_encode)).map_err(|e| e.to_string())?;
    globals.set("__hexDecode", Function::new(ctx.clone(), b_hex_decode)).map_err(|e| e.to_string())?;
    globals.set("__sha256Bytes", Function::new(ctx.clone(), b_sha256_bytes)).map_err(|e| e.to_string())?;
    globals.set("__decodePacked", Function::new(ctx.clone(), b_decode_packed)).map_err(|e| e.to_string())?;
    globals.set("__randomBytes", Function::new(ctx.clone(), b_random_bytes)).map_err(|e| e.to_string())?;
    globals.set("__randomHex", Function::new(ctx.clone(), b_random_hex)).map_err(|e| e.to_string())?;
    globals.set("__randomUUID", Function::new(ctx.clone(), b_random_uuid)).map_err(|e| e.to_string())?;
    globals.set("__aesEncrypt", Function::new(ctx.clone(), b_aes_encrypt)).map_err(|e| e.to_string())?;
    globals.set("__rsaEncrypt", Function::new(ctx.clone(), b_rsa_encrypt)).map_err(|e| e.to_string())?;
    globals.set("__ecdhPublicKey", Function::new(ctx.clone(), b_ecdh_public_key)).map_err(|e| e.to_string())?;
    Ok(())
}

// 以下 b_* 是暴露给 JS 的宿主函数，错误一律抛成 JS 异常（等价 Go 绑定里的 panic）。

fn b_parse_url(ctx: Ctx<'_>, value: String, base: String) -> rquickjs::Result<String> {
    parse_url(&value, &base).map_err(|e| throw_value(&ctx, e))
}

fn b_set_url_query(ctx: Ctx<'_>, value: String, query: String) -> rquickjs::Result<String> {
    set_url_query(&value, &query).map_err(|e| throw_value(&ctx, e))
}

fn b_utf8_encode(value: String) -> String {
    bytes_json(value.as_bytes())
}

fn b_utf8_decode(ctx: Ctx<'_>, raw: String) -> rquickjs::Result<String> {
    bytes_from_json(&raw)
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        .map_err(|e| throw_value(&ctx, e))
}

fn b_base64_encode(ctx: Ctx<'_>, raw: String) -> rquickjs::Result<String> {
    bytes_from_json(&raw)
        .map(|bytes| STANDARD.encode(bytes))
        .map_err(|e| throw_value(&ctx, e))
}

fn b_base64_decode(ctx: Ctx<'_>, value: String) -> rquickjs::Result<String> {
    STANDARD
        .decode(value.as_bytes())
        .or_else(|_| STANDARD_NO_PAD.decode(value.as_bytes()))
        .map(|bytes| bytes_json(&bytes))
        .map_err(|e| throw_value(&ctx, e.to_string()))
}

fn b_hex_encode(ctx: Ctx<'_>, raw: String) -> rquickjs::Result<String> {
    bytes_from_json(&raw)
        .map(hex::encode)
        .map_err(|e| throw_value(&ctx, e))
}

fn b_hex_decode(ctx: Ctx<'_>, value: String) -> rquickjs::Result<String> {
    hex::decode(value.trim())
        .map(|b| bytes_json(&b))
        .map_err(|e| throw_value(&ctx, e.to_string()))
}

fn b_sha256_bytes(ctx: Ctx<'_>, raw: String) -> rquickjs::Result<String> {
    bytes_from_json(&raw)
        .map(|b| bytes_json(&Sha256::digest(b)))
        .map_err(|e| throw_value(&ctx, e))
}

fn b_decode_packed(ctx: Ctx<'_>, value: String) -> rquickjs::Result<String> {
    decode_packed(&value)
        .map(|b| bytes_json(&b))
        .map_err(|e| throw_value(&ctx, e))
}

fn b_random_bytes(size: i64) -> String {
    let mut bytes = vec![0u8; size.max(0) as usize];
    rand::rng().fill_bytes(&mut bytes);
    bytes_json(&bytes)
}

fn b_random_hex(size: i64) -> String {
    let mut bytes = vec![0u8; size.max(0) as usize];
    rand::rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

fn b_random_uuid() -> String {
    random_uuid()
}

fn b_aes_encrypt(ctx: Ctx<'_>, key_hex: String, plaintext: String) -> rquickjs::Result<String> {
    aes_encrypt(&key_hex, &plaintext).map_err(|e| throw_value(&ctx, e))
}

fn b_rsa_encrypt(ctx: Ctx<'_>, public_key: String, plaintext: String) -> rquickjs::Result<String> {
    rsa_encrypt(&public_key, &plaintext).map_err(|e| throw_value(&ctx, e))
}

fn b_ecdh_public_key(ctx: Ctx<'_>) -> rquickjs::Result<String> {
    ecdh_public_key().map_err(|e| throw_value(&ctx, e))
}

fn bytes_json(bytes: &[u8]) -> String {
    serde_json::to_string(bytes).unwrap_or_else(|_| "[]".into())
}

fn bytes_from_json(raw: &str) -> Result<Vec<u8>, String> {
    let values: Vec<i64> = serde_json::from_str(raw).map_err(|e| format!("解析字节数组失败: {e}"))?;
    values
        .iter()
        .enumerate()
        .map(|(index, value)| {
            if !(0..=255).contains(value) {
                return Err(format!("invalid byte at index {index}"));
            }
            Ok(*value as u8)
        })
        .collect()
}

fn parse_url(value: &str, base: &str) -> Result<String, String> {
    let parsed = if !base.is_empty() {
        let base_url = url::Url::parse(base).map_err(|e| format!("解析 base URL 失败: {e}"))?;
        base_url.join(value).map_err(|e| format!("解析 URL 失败: {e}"))?
    } else {
        url::Url::parse(value).map_err(|e| format!("解析 URL 失败: {e}"))?
    };
    Ok(marshal_url(&parsed))
}

fn set_url_query(value: &str, query: &str) -> Result<String, String> {
    let mut parsed = url::Url::parse(value).map_err(|e| format!("解析 URL 失败: {e}"))?;
    parsed.set_query(Some(query));
    Ok(marshal_url(&parsed))
}

/// 输出字段与 Go net/url 的 marshalURL 对齐（垫片里的 URL 类按这些键读取）。
fn marshal_url(u: &url::Url) -> String {
    let host = u.host_str().unwrap_or("");
    let host_with_port = match u.port() {
        Some(port) => format!("{host}:{port}"),
        None => host.to_string(),
    };
    let origin = if !u.scheme().is_empty() && !host.is_empty() {
        format!("{}://{}", u.scheme(), host_with_port)
    } else {
        String::new()
    };
    serde_json::json!({
        "href": u.as_str(),
        "origin": origin,
        "protocol": format!("{}:", u.scheme()),
        "username": u.username(),
        "password": u.password().unwrap_or(""),
        "host": host_with_port,
        "hostname": host,
        "port": u.port().map(|p| p.to_string()).unwrap_or_default(),
        "pathname": u.path(),
        "search": u.query().unwrap_or(""),
        "hash": u.fragment().unwrap_or(""),
    })
    .to_string()
}

fn decode_packed(value: &str) -> Result<Vec<u8>, String> {
    let raw = STANDARD
        .decode(value.trim())
        .map_err(|e| format!("base64 解码 packed 失败: {e}"))?;
    if raw.len() < 9 {
        return Err("packed payload is too short".into());
    }
    let key: usize = raw[4..8].iter().map(|b| *b as usize).sum::<usize>() % 256;
    let compressed: Vec<u8> = raw[8..]
        .iter()
        .enumerate()
        .map(|(index, byte)| byte ^ ((key + (key % 10) * index) % 256) as u8)
        .collect();
    let mut decoder = DeflateDecoder::new(&compressed[..]);
    let mut output = Vec::new();
    decoder
        .read_to_end(&mut output)
        .map_err(|e| format!("解压 packed 失败: {e}"))?;
    Ok(output)
}

fn random_uuid() -> String {
    let mut value = [0u8; 16];
    rand::rng().fill_bytes(&mut value);
    value[6] = (value[6] & 0x0f) | 0x40;
    value[8] = (value[8] & 0x3f) | 0x80;
    format!(
        "{:08x}-{:04x}-{:04x}-{:04x}-{:012x}",
        u32::from_be_bytes(value[0..4].try_into().unwrap()),
        u16::from_be_bytes(value[4..6].try_into().unwrap()),
        u16::from_be_bytes(value[6..8].try_into().unwrap()),
        u16::from_be_bytes(value[8..10].try_into().unwrap()),
        u64::from_be_bytes(value[10..16].try_into().unwrap()) & 0x000f_ffff_ffff_ffff,
    )
}

fn aes_encrypt(key_hex: &str, plaintext: &str) -> Result<String, String> {
    use cbc::cipher::block_padding::Pkcs7;
    use cbc::cipher::generic_array::GenericArray;
    use cbc::cipher::{BlockEncryptMut, KeyIvInit};

    let key = hex::decode(key_hex.trim()).map_err(|e| format!("AES key hex 解码失败: {e}"))?;
    if key.len() != 16 {
        return Err(format!("仅支持 AES-128（16 字节 key），实际 {} 字节", key.len()));
    }
    let mut iv = [0u8; 16];
    rand::rng().fill_bytes(&mut iv);
    let encryptor: cbc::Encryptor<aes::Aes128> = cbc::Encryptor::new(
        GenericArray::from_slice(&key),
        GenericArray::from_slice(&iv),
    );
    let encrypted = encryptor.encrypt_padded_vec_mut::<Pkcs7>(plaintext.as_bytes());
    let mut cipher_text = Vec::with_capacity(16 + encrypted.len());
    cipher_text.extend_from_slice(&iv);
    cipher_text.extend_from_slice(&encrypted);
    Ok(serde_json::json!({
        "cipherText": STANDARD.encode(cipher_text),
        "encryptedData": STANDARD.encode(encrypted),
        "iv": STANDARD.encode(iv),
    })
    .to_string())
}

/// RSA/PKCS1v15 加密。入参支持：PEM 文本、base64 包裹的 PEM（dtrait-params 用）、
/// 裸 DER（PKCS#1 RSAPublicKey 或 PKIX SubjectPublicKeyInfo）。
fn rsa_encrypt(public_key: &str, plaintext: &str) -> Result<String, String> {
    use rsa::pkcs1::DecodeRsaPublicKey;
    use rsa::pkcs8::DecodePublicKey;
    use rsa::Pkcs1v15Encrypt;

    let trimmed = public_key.trim();
    let pem_text;
    let der_bytes;
    let key = if trimmed.contains("BEGIN") {
        parse_pem_rsa(trimmed)?
    } else {
        let decoded = STANDARD
            .decode(trimmed.as_bytes())
            .or_else(|_| STANDARD_NO_PAD.decode(trimmed.as_bytes()))
            .map_err(|e| format!("RSA 公钥 base64 解码失败: {e}"))?;
        match String::from_utf8(decoded.clone()) {
            Ok(text) if text.contains("BEGIN") => {
                pem_text = text;
                parse_pem_rsa(&pem_text)?
            }
            _ => {
                der_bytes = decoded;
                rsa::RsaPublicKey::from_public_key_der(&der_bytes)
                    .or_else(|_| rsa::RsaPublicKey::from_pkcs1_der(&der_bytes))
                    .map_err(|e| format!("RSA 公钥 DER 解析失败: {e}"))?
            }
        }
    };

    let mut rng = rand_core::OsRng;
    let encrypted = key
        .encrypt(&mut rng, Pkcs1v15Encrypt, plaintext.as_bytes())
        .map_err(|e| format!("RSA 加密失败: {e}"))?;
    Ok(STANDARD.encode(encrypted))
}

fn parse_pem_rsa(pem: &str) -> Result<rsa::RsaPublicKey, String> {
    use rsa::pkcs1::DecodeRsaPublicKey;
    use rsa::pkcs8::DecodePublicKey;

    if pem.contains("BEGIN RSA PUBLIC KEY") {
        rsa::RsaPublicKey::from_pkcs1_pem(pem).map_err(|e| format!("PKCS#1 RSA 公钥解析失败: {e}"))
    } else if pem.contains("BEGIN PUBLIC KEY") {
        rsa::RsaPublicKey::from_public_key_pem(pem).map_err(|e| format!("PKIX 公钥解析失败: {e}"))
    } else if pem.contains("CERTIFICATE") {
        Err("暂不支持证书形式的 RSA 公钥".into())
    } else {
        Err("无法识别的 PEM 公钥类型".into())
    }
}

fn ecdh_public_key() -> Result<String, String> {
    use p256::elliptic_curve::sec1::ToEncodedPoint;
    let secret = p256::SecretKey::random(&mut rand_core::OsRng);
    let point = secret.public_key().to_encoded_point(false);
    Ok(STANDARD.encode(point.as_bytes()))
}
