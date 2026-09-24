//! 磁盘插件的 FFI 层：宿主 vtable、JSON 信封编解码与插件导出宏。
//!
//! 边界约定（详见 [`crate::abi`] 模块文档）：
//! - 所有跨边界结果统一为 JSON 信封 `{"ok":true,"value":...}` /
//!   `{"ok":false,"error":"..."}` 的 C 字符串；
//! - 命令调用是「同步发起、异步完成」：`mb_plugin_invoke` 立即返回，
//!   完成时回调宿主提供的 `done`。

use std::ffi::{c_char, c_void, CStr, CString};
use std::path::PathBuf;

use serde_json::{json, Value};

use crate::host::{BiliCredentials, HostApi, WindowOptions};

/// `*mut c_void` 的 Send 包装：done_data 由宿主创建并在其回调中消费，
/// 指针本身只在回调现场使用，跨线程传递是安全的。
///
/// # Safety
/// 仅用于 [`HostVTable`] 回调约定的 done_data 指针。
#[derive(Clone, Copy)]
pub struct SendPtr(pub *mut c_void);
unsafe impl Send for SendPtr {}

/// 宿主提供的函数表（repr(C) 函数指针表，进程内 static，'static 有效）
#[repr(C)]
pub struct HostVTable {
    /// 释放宿主分配的返回字符串（信封）
    pub free_string: unsafe extern "C" fn(*mut c_char),
    /// `()` → 信封（value = 数据目录路径字符串）
    pub data_dir: unsafe extern "C" fn() -> *mut c_char,
    /// `(args_json: {event, payload})` → 信封
    pub emit: unsafe extern "C" fn(*const c_char) -> *mut c_char,
    /// `(mid: null | JSON string)` → 信封（value = {mid, cookie}）
    pub bili_credentials: unsafe extern "C" fn(*const c_char) -> *mut c_char,
    /// `(label)` → 信封（value = bool）
    pub window_exists: unsafe extern "C" fn(*const c_char) -> *mut c_char,
    /// `(options_json: WindowOptions)` → 信封
    pub create_window: unsafe extern "C" fn(*const c_char) -> *mut c_char,
    /// `(label)` → 信封
    pub focus_window: unsafe extern "C" fn(*const c_char) -> *mut c_char,
    /// `(path)` → 信封（资源管理器定位文件）
    pub reveal_path: unsafe extern "C" fn(*const c_char) -> *mut c_char,
}

// ---------------------------------------------------------------------------
// 信封编解码
// ---------------------------------------------------------------------------

/// 成功信封 → 插件侧分配的 C 字符串（由宿主经 `free_string` 释放）
pub fn ok_envelope(value: Value) -> *mut c_char {
    envelope(json!({ "ok": true, "value": value }))
}

/// 失败信封 → 插件侧分配的 C 字符串
pub fn err_envelope(message: String) -> *mut c_char {
    envelope(json!({ "ok": false, "error": message }))
}

fn envelope(v: Value) -> *mut c_char {
    // JSON 序列化输出不含 NUL，CString::new 实际不会失败；兜底为固定错误串
    CString::new(v.to_string())
        .or_else(|_| CString::new(r#"{"ok":false,"error":"信封序列化失败"}"#))
        .expect("CString 序列化失败")
        .into_raw()
}

/// 解析对方返回的信封字符串并经 `free_string` 释放
///
/// # Safety
/// `ptr` 必须是对方分配的有效 C 字符串，且 `free` 与其分配方匹配。
pub unsafe fn parse_envelope(
    ptr: *mut c_char,
    free: unsafe extern "C" fn(*mut c_char),
) -> Result<Value, String> {
    if ptr.is_null() {
        return Err("宿主返回了空指针".to_string());
    }
    let text = CStr::from_ptr(ptr).to_string_lossy().into_owned();
    free(ptr);
    let v: Value =
        serde_json::from_str(&text).map_err(|e| format!("宿主返回了无效信封: {e}"))?;
    if v.get("ok").and_then(Value::as_bool).unwrap_or(false) {
        Ok(v.get("value").cloned().unwrap_or(Value::Null))
    } else {
        Err(v
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("未知错误")
            .to_string())
    }
}

/// 同步 vtable 调用辅助：构造单个字符串入参 → 调用 → 解析信封
unsafe fn call_str(
    vtable: &HostVTable,
    arg: &str,
    f: impl FnOnce(*const c_char) -> *mut c_char,
) -> Result<Value, String> {
    let c_arg = CString::new(arg).map_err(|e| format!("参数含 NUL 字节: {e}"))?;
    let ptr = f(c_arg.as_ptr());
    parse_envelope(ptr, vtable.free_string)
}

// ---------------------------------------------------------------------------
// FfiHost：磁盘插件侧的 HostApi 实现
// ---------------------------------------------------------------------------

/// 包装宿主 vtable 的 [`HostApi`] 实现（磁盘插件使用）
pub struct FfiHost {
    vtable: &'static HostVTable,
}

impl FfiHost {
    /// # Safety
    /// `ptr` 必须指向宿主提供的、进程内 'static 有效的 [`HostVTable`]。
    pub unsafe fn from_ptr(ptr: *const HostVTable) -> Result<Self, String> {
        if ptr.is_null() {
            return Err("宿主传入了空 vtable".to_string());
        }
        Ok(Self { vtable: &*ptr })
    }
}

impl HostApi for FfiHost {
    fn data_dir(&self) -> Result<PathBuf, String> {
        unsafe {
            let value = call_str(self.vtable, "", |_| (self.vtable.data_dir)())?;
            serde_json::from_value(value).map_err(|e| format!("数据目录解析失败: {e}"))
        }
    }

    fn emit(&self, event: &str, payload: &Value) -> Result<(), String> {
        unsafe {
            let arg = json!({ "event": event, "payload": payload }).to_string();
            call_str(self.vtable, &arg, |ptr| (self.vtable.emit)(ptr))?;
            Ok(())
        }
    }

    fn bili_credentials(&self, mid: Option<&str>) -> Result<BiliCredentials, String> {
        unsafe {
            let arg = match mid {
                Some(mid) => serde_json::to_string(mid).map_err(|e| e.to_string())?,
                None => "null".to_string(),
            };
            let value = call_str(self.vtable, &arg, |ptr| {
                (self.vtable.bili_credentials)(ptr)
            })?;
            serde_json::from_value(value).map_err(|e| format!("凭据解析失败: {e}"))
        }
    }

    fn window_exists(&self, label: &str) -> bool {
        unsafe {
            call_str(self.vtable, label, |ptr| (self.vtable.window_exists)(ptr))
                .ok()
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
        }
    }

    fn create_window(&self, options: &WindowOptions) -> Result<(), String> {
        unsafe {
            let arg = serde_json::to_string(options).map_err(|e| e.to_string())?;
            call_str(self.vtable, &arg, |ptr| (self.vtable.create_window)(ptr))?;
            Ok(())
        }
    }

    fn focus_window(&self, label: &str) -> Result<(), String> {
        unsafe {
            call_str(self.vtable, label, |ptr| (self.vtable.focus_window)(ptr))?;
            Ok(())
        }
    }

    fn reveal_path(&self, path: &str) -> Result<(), String> {
        unsafe {
            call_str(self.vtable, path, |ptr| (self.vtable.reveal_path)(ptr))?;
            Ok(())
        }
    }
}

// ---------------------------------------------------------------------------
// 插件导出宏
// ---------------------------------------------------------------------------

/// 声明 MimiBox 磁盘插件的全部 C 导出符号。
///
/// 用法：`mimibox_plugin::export_plugin!(LotteryPlugin);`
/// 其中 `LotteryPlugin` 实现 [`crate::PluginBackend`]。
#[macro_export]
macro_rules! export_plugin {
    ($plugin:expr) => {
        static __MB_REGISTRY: std::sync::OnceLock<$crate::registry::Registry> =
            std::sync::OnceLock::new();
        static __MB_RUNTIME: std::sync::OnceLock<$crate::tokio::runtime::Runtime> =
            std::sync::OnceLock::new();
        static __MB_HOST: std::sync::OnceLock<std::sync::Arc<dyn $crate::host::HostApi>> =
            std::sync::OnceLock::new();

        /// ABI 版本（宿主加载前校验）
        #[no_mangle]
        pub extern "C" fn mb_abi_version() -> u32 {
            $crate::abi::MB_ABI_VERSION
        }

        /// 释放插件分配的 C 字符串（宿主读取插件返回值后调用）
        #[no_mangle]
        pub extern "C" fn mb_free_string(ptr: *mut std::os::raw::c_char) {
            if !ptr.is_null() {
                drop(unsafe { std::ffi::CString::from_raw(ptr) });
            }
        }

        /// 注册插件：建立宿主句柄、执行命令注册，返回命令清单信封
        /// `{"ok":true,"value":{"commands":["a","b"]}}`
        #[no_mangle]
        pub extern "C" fn mb_plugin_register(
            host_vtable: *const $crate::ffi::HostVTable,
        ) -> *mut std::os::raw::c_char {
            let plugin = $plugin;
            let host: std::sync::Arc<dyn $crate::host::HostApi> =
                match unsafe { $crate::ffi::FfiHost::from_ptr(host_vtable) } {
                    Ok(host) => std::sync::Arc::new(host),
                    Err(e) => return $crate::ffi::err_envelope(e),
                };
            let _ = __MB_HOST.set(host);

            let mut registry = $crate::registry::Registry::new();
            plugin.register(&mut registry);
            let commands = registry.command_names();
            let _ = __MB_REGISTRY.set(registry);

            let _ = __MB_RUNTIME.get_or_init(|| {
                $crate::tokio::runtime::Builder::new_multi_thread()
                    .enable_all()
                    .build()
                    .expect("插件 tokio runtime 初始化失败")
            });

            $crate::ffi::ok_envelope($crate::serde_json::json!({ "commands": commands }))
        }

        /// 调用插件命令：同步发起，完成后回调 `done(done_data, result_json, is_err)`。
        /// result_json 仅在回调执行期间有效，回调返回后由插件释放。
        #[no_mangle]
        pub unsafe extern "C" fn mb_plugin_invoke(
            command: *const std::os::raw::c_char,
            args_json: *const std::os::raw::c_char,
            done: unsafe extern "C" fn(
                *mut std::os::raw::c_void,
                *const std::os::raw::c_char,
                i32,
            ),
            done_data: *mut std::os::raw::c_void,
        ) {
            let read = |p: *const std::os::raw::c_char| -> String {
                if p.is_null() {
                    String::new()
                } else {
                    unsafe { std::ffi::CStr::from_ptr(p).to_string_lossy().into_owned() }
                }
            };
            let command = read(command);
            let args: $crate::serde_json::Value =
                serde_json::from_str(&read(args_json)).unwrap_or($crate::serde_json::Value::Null);
            let done_data = $crate::ffi::SendPtr(done_data);

            let respond = move |result: Result<$crate::serde_json::Value, String>| {
                // 闭包内先整体 move SendPtr，避免 disjoint capture 精确捕获裸指针字段
                let done_data = done_data;
                let (payload, is_err) = match &result {
                    Ok(v) => (
                        $crate::serde_json::json!({ "ok": true, "value": v }).to_string(),
                        0,
                    ),
                    Err(e) => (
                        $crate::serde_json::json!({ "ok": false, "error": e }).to_string(),
                        1,
                    ),
                };
                match std::ffi::CString::new(payload) {
                    Ok(c) => done(done_data.0, c.as_ptr(), is_err),
                    Err(_) => {
                        let fallback = std::ffi::CString::new(
                            r#"{"ok":false,"error":"插件返回内容含 NUL 字节"}"#,
                        )
                        .expect("fallback 信封序列化失败");
                        done(done_data.0, fallback.as_ptr(), 1);
                    }
                }
            };

            let Some(registry) = __MB_REGISTRY.get() else {
                respond(Err("插件尚未注册（mb_plugin_register 未调用或失败）".to_string()));
                return;
            };
            let Some(runtime) = __MB_RUNTIME.get() else {
                respond(Err("插件运行时尚未初始化".to_string()));
                return;
            };
            let Some(host) = __MB_HOST.get() else {
                respond(Err("插件宿主句柄缺失".to_string()));
                return;
            };

            let ctx = $crate::registry::InvokeCtx { host: host.clone() };
            match registry.dispatch(ctx, &command, args) {
                Ok(future) => {
                    // panic 隔离：命令崩溃时以 JoinError 文本作为错误返回，
                    // 不让 unwind 跨越 FFI 边界（panic=abort 构建下仍会终止进程）
                    let handle = runtime.spawn(async move { future.await });
                    runtime.spawn(async move {
                        let result = match handle.await {
                            Ok(result) => result,
                            Err(join_error) => Err(format!("插件命令崩溃: {join_error}")),
                        };
                        respond(result);
                    });
                }
                Err(e) => respond(Err(e)),
            }
        }
    };
}
