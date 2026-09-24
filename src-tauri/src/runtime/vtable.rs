//! 磁盘插件的宿主侧 FFI：静态 HostVTable 与全局宿主句柄。
//!
//! vtable 以 `&'static` 传给插件 dll，因此函数表与宿主句柄都是进程级
//! static；宿主句柄在加载任何磁盘插件之前设置一次（setup 阶段）。
//! 所有入口都用 `catch_unwind` 包裹：dev 构建（unwind）下插件侧调用
//! 崩溃时降级为错误信封；release（panic=abort）直接终止进程，符合
//! 「panic 隔离尽力而为」的边界。

use std::ffi::{c_char, CStr, CString};
use std::sync::{Arc, OnceLock};

use mimibox_plugin::ffi::{err_envelope, ok_envelope, HostVTable};
use mimibox_plugin::{HostApi, WindowOptions};
use serde_json::{json, Value};

use super::host::HostImpl;

static HOST: OnceLock<Arc<HostImpl>> = OnceLock::new();

/// 设置全局宿主句柄（进程内只允许一次，重复设置报错）
pub fn install_host(host: Arc<HostImpl>) -> Result<(), String> {
    HOST.set(host).map_err(|_| "宿主句柄已被设置".to_string())
}

/// 宿主 vtable（进程内 static，'static 有效）
pub fn vtable() -> &'static HostVTable {
    &VTABLE
}

static VTABLE: HostVTable = HostVTable {
    free_string: vt_free_string,
    data_dir: vt_data_dir,
    emit: vt_emit,
    bili_credentials: vt_bili_credentials,
    window_exists: vt_window_exists,
    create_window: vt_create_window,
    focus_window: vt_focus_window,
    reveal_path: vt_reveal_path,
};

/// 捕获 vtable 调用中的 panic（dev unwind 下降级为错误信封）
fn guard<F: FnOnce() -> *mut c_char>(f: F) -> *mut c_char {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(ptr) => ptr,
        Err(_) => err_envelope("宿主能力调用崩溃".to_string()),
    }
}

/// 读取调用方分配的 C 字符串（只读，所有权仍归调用方）
unsafe fn read_str(ptr: *const c_char) -> String {
    if ptr.is_null() {
        String::new()
    } else {
        unsafe { CStr::from_ptr(ptr).to_string_lossy().into_owned() }
    }
}

fn with_host(f: impl FnOnce(&HostImpl) -> *mut c_char) -> *mut c_char {
    guard(|| match HOST.get() {
        Some(host) => f(host),
        None => err_envelope("宿主句柄尚未初始化".to_string()),
    })
}

unsafe extern "C" fn vt_free_string(ptr: *mut c_char) {
    if !ptr.is_null() {
        drop(unsafe { CString::from_raw(ptr) });
    }
}

unsafe extern "C" fn vt_data_dir() -> *mut c_char {
    with_host(|host| match host.data_dir() {
        Ok(dir) => ok_envelope(json!(dir.to_string_lossy().into_owned())),
        Err(e) => err_envelope(e),
    })
}

unsafe extern "C" fn vt_emit(args: *const c_char) -> *mut c_char {
    with_host(|host| {
        let parsed: Result<Value, _> = serde_json::from_str(&unsafe { read_str(args) });
        let Ok(value) = parsed else {
            return err_envelope("emit 参数解析失败".to_string());
        };
        let Some(event) = value.get("event").and_then(Value::as_str) else {
            return err_envelope("emit 参数缺少 event 字段".to_string());
        };
        let default_payload = Value::Null;
        let payload = value.get("payload").unwrap_or(&default_payload);
        match host.emit(event, payload) {
            Ok(()) => ok_envelope(Value::Null),
            Err(e) => err_envelope(e),
        }
    })
}

unsafe extern "C" fn vt_bili_credentials(args: *const c_char) -> *mut c_char {
    with_host(|host| {
        let text = unsafe { read_str(args) };
        let mid: Option<String> = match serde_json::from_str(&text) {
            Ok(Value::Null) => None,
            Ok(Value::String(mid)) => Some(mid),
            Ok(_) => return err_envelope("bili_credentials 参数须为 null 或字符串".to_string()),
            Err(e) => return err_envelope(format!("bili_credentials 参数解析失败: {e}")),
        };
        match host.bili_credentials(mid.as_deref()) {
            Ok(credentials) => ok_envelope(json!({
                "mid": credentials.mid,
                "cookie": credentials.cookie,
            })),
            Err(e) => err_envelope(e),
        }
    })
}

unsafe extern "C" fn vt_window_exists(args: *const c_char) -> *mut c_char {
    with_host(|host| ok_envelope(json!(host.window_exists(&unsafe { read_str(args) }))))
}

unsafe extern "C" fn vt_create_window(args: *const c_char) -> *mut c_char {
    with_host(|host| {
        let text = unsafe { read_str(args) };
        match serde_json::from_str::<WindowOptions>(&text) {
            Ok(options) => match host.create_window(&options) {
                Ok(()) => ok_envelope(Value::Null),
                Err(e) => err_envelope(e),
            },
            Err(e) => err_envelope(format!("create_window 参数解析失败: {e}")),
        }
    })
}

unsafe extern "C" fn vt_focus_window(args: *const c_char) -> *mut c_char {
    with_host(|host| match host.focus_window(&unsafe { read_str(args) }) {
        Ok(()) => ok_envelope(Value::Null),
        Err(e) => err_envelope(e),
    })
}

unsafe extern "C" fn vt_reveal_path(args: *const c_char) -> *mut c_char {
    with_host(|host| match host.reveal_path(&unsafe { read_str(args) }) {
        Ok(()) => ok_envelope(Value::Null),
        Err(e) => err_envelope(e),
    })
}
