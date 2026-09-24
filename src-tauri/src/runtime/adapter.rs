//! cordis Plugin 适配器：内置插件（进程内直连）与磁盘插件（FFI 桥）。
//!
//! 两类插件在 apply 阶段做同一件事：把命令注册进 CommandRegistry 服务，
//! 并登记「卸载时注销命令」的清理 effect。区别只在命令实现来源：
//! 内置插件直接调用进程内函数，磁盘插件经 [`PluginLibrary`] 走 FFI。

use std::collections::HashMap;
use std::convert::Infallible;
use std::ffi::{c_char, c_void, CStr, CString};
use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use std::sync::Arc;

use cordis::{Context, InjectSpec, Plugin, Service};
use mimibox_plugin::ffi::{parse_envelope, HostVTable};
use mimibox_plugin::{BoxedHandler, InvokeCtx, PluginBackend, Registry};
use serde_json::Value;

use super::services::{CommandRegistry, RuntimeError};

// ---------------------------------------------------------------------------
// 内置插件适配器
// ---------------------------------------------------------------------------

/// 内置插件：进程内直接构造 SDK Registry，不经过 FFI。
pub(crate) struct BuiltinPlugin<P: PluginBackend> {
    pub id: &'static str,
    /// 命令注册表之外的 cordis 服务依赖
    pub requires: &'static [&'static str],
    pub plugin: P,
}

impl<P: PluginBackend> Plugin for BuiltinPlugin<P> {
    type Config = ();
    type Input = ();
    type PrepareError = Infallible;
    type ApplyError = RuntimeError;

    fn name(&self) -> std::borrow::Cow<'_, str> {
        std::borrow::Cow::Borrowed(self.id)
    }

    fn inject(&self) -> InjectSpec {
        let mut spec = InjectSpec::none().require(CommandRegistry::NAME);
        for name in self.requires {
            spec = spec.require(*name);
        }
        spec
    }

    fn prepare(&self, (): ()) -> Result<(), Infallible> {
        Ok(())
    }

    async fn apply(&self, ctx: Context, _input: &()) -> Result<(), RuntimeError> {
        let mut registry = Registry::new();
        self.plugin.register(&mut registry);
        apply_commands(&ctx, self.id, registry.into_commands()).await
    }
}

// ---------------------------------------------------------------------------
// 磁盘插件 dll 句柄
// ---------------------------------------------------------------------------

/// `mb_plugin_invoke` 的完成回调签名
type InvokeDoneFn = unsafe extern "C" fn(*mut c_void, *const c_char, i32);
/// `mb_plugin_invoke` 导出函数签名
type InvokeFn = unsafe extern "C" fn(*const c_char, *const c_char, InvokeDoneFn, *mut c_void);

/// 已加载插件 dll 的进程内句柄。
///
/// 生命周期说明：实例由 cordis Fiber 持有，随应用进程退出；**不主动
/// FreeLibrary**——Windows 下卸载仍可能被 CommandRegistry handler 引用的
/// cdylib 不安全，即使插件 Fiber 被处置也保持加载（泄漏即安全）。
pub(crate) struct PluginLibrary(libloading::Library);

impl std::fmt::Debug for PluginLibrary {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PluginLibrary")
    }
}

impl PluginLibrary {
    /// 加载插件 dll（路径由清单 entry.backend 给出）
    pub(crate) fn new(path: &Path) -> Result<Self, String> {
        unsafe { libloading::Library::new(path) }
            .map(Self)
            .map_err(|e| format!("无法加载插件库 {}: {e}", path.display()))
    }

    /// 读取插件 ABI 版本（加载后与宿主校验）
    pub(crate) fn abi_version(&self) -> Result<u32, String> {
        let f: libloading::Symbol<unsafe extern "C" fn() -> u32> = unsafe {
            self.0
                .get(b"mb_abi_version\0")
                .map_err(|e| format!("插件缺少 mb_abi_version 导出: {e}"))
        }?;
        Ok(unsafe { f() })
    }

    /// 执行插件注册（mb_plugin_register），返回声明的命令清单
    pub(crate) fn declare(&self, vtable: *const HostVTable) -> Result<Vec<String>, String> {
        unsafe {
            let register: libloading::Symbol<
                unsafe extern "C" fn(*const HostVTable) -> *mut c_char,
            > = self
                .0
                .get(b"mb_plugin_register\0")
                .map_err(|e| format!("插件缺少 mb_plugin_register 导出: {e}"))?;
            let free: libloading::Symbol<unsafe extern "C" fn(*mut c_char)> = self
                .0
                .get(b"mb_free_string\0")
                .map_err(|e| format!("插件缺少 mb_free_string 导出: {e}"))?;
            let value = parse_envelope(register(vtable), *free)?;
            Ok(value
                .get("commands")
                .and_then(Value::as_array)
                .map(|list| {
                    list.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default())
        }
    }

    /// 调用插件命令：同步发起、经完成回调异步送达。
    /// 同步失败（缺符号/参数含 NUL）立即返回 Err 并回收回调数据。
    pub(crate) fn call(
        &self,
        command: &str,
        args: &str,
    ) -> Result<impl Future<Output = Result<Value, String>> + Send + 'static, String> {
        let (tx, rx) = tokio::sync::oneshot::channel::<Result<Value, String>>();
        let tx = Box::into_raw(Box::new(tx));
        let invoke = unsafe { self.0.get::<InvokeFn>(b"mb_plugin_invoke\0") };
        let cmd = CString::new(command);
        let arg = CString::new(args);
        let reason = match (&invoke, &cmd, &arg) {
            (Err(e), _, _) => e.to_string(),
            (_, Err(e), _) => e.to_string(),
            (_, _, Err(e)) => e.to_string(),
            _ => String::new(),
        };
        let (Ok(invoke), Ok(cmd), Ok(arg)) = (invoke, cmd, arg) else {
            drop(unsafe { Box::from_raw(tx) });
            return Err(format!("插件命令「{command}」调用失败: {reason}"));
        };
        unsafe { invoke(cmd.as_ptr(), arg.as_ptr(), done_callback, tx as *mut c_void) };
        Ok(async move {
            rx.await
                .unwrap_or_else(|_| Err("插件命令回调丢失".to_string()))
        })
    }
}

/// mb_plugin_invoke 完成回调：解析信封并送达 oneshot。
/// data 是 Box 分配的 Sender 指针，回调取回所有权；在插件运行时线程上执行，
/// 整体 catch_unwind 防止 panic 跨越 FFI 边界。
unsafe extern "C" fn done_callback(data: *mut c_void, result: *const c_char, _is_err: i32) {
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| unsafe {
        let tx = Box::from_raw(data as *mut tokio::sync::oneshot::Sender<Result<Value, String>>);
        let text = if result.is_null() {
            r#"{"ok":false,"error":"插件返回了空结果"}"#.to_string()
        } else {
            CStr::from_ptr(result).to_string_lossy().into_owned()
        };
        let _ = tx.send(parse_envelope_text(&text));
    }));
}

/// 解析插件返回的 JSON 信封 `{"ok":true,"value":...}` / `{"ok":false,"error":...}`
fn parse_envelope_text(text: &str) -> Result<Value, String> {
    let v: Value = serde_json::from_str(text).map_err(|e| format!("插件返回了无效信封: {e}"))?;
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

// ---------------------------------------------------------------------------
// 磁盘插件适配器
// ---------------------------------------------------------------------------

/// 磁盘插件：命令经 FFI 桥转发进插件 dll（插件在自己的 tokio runtime 执行）。
pub(crate) struct DiskPlugin {
    pub manifest: crate::loader::PluginManifest,
    /// 注册时声明的命令清单
    pub commands: Vec<String>,
    pub lib: Arc<PluginLibrary>,
}

impl Plugin for DiskPlugin {
    type Config = ();
    type Input = ();
    type PrepareError = Infallible;
    type ApplyError = RuntimeError;

    fn name(&self) -> std::borrow::Cow<'_, str> {
        std::borrow::Cow::Borrowed(self.manifest.id.as_str())
    }

    fn inject(&self) -> InjectSpec {
        let mut spec = InjectSpec::none().require(CommandRegistry::NAME);
        for name in &self.manifest.requires {
            spec = spec.require(name.as_str());
        }
        spec
    }

    fn prepare(&self, (): ()) -> Result<(), Infallible> {
        Ok(())
    }

    async fn apply(&self, ctx: Context, _input: &()) -> Result<(), RuntimeError> {
        let mut handlers: HashMap<String, BoxedHandler> = HashMap::new();
        for command in &self.commands {
            handlers.insert(
                command.clone(),
                make_disk_handler(self.lib.clone(), command.clone()),
            );
        }
        apply_commands(&ctx, &self.manifest.id, handlers).await
    }
}

/// 磁盘插件命令 handler：把「JSON 入参 → 插件 dll → JSON 出参」桥成 Future。
/// 同步发起失败（缺符号等）在 handler 调用时立即返回错误。
fn make_disk_handler(lib: Arc<PluginLibrary>, command: String) -> BoxedHandler {
    Arc::new(move |_ctx: InvokeCtx, args: Value| {
        let lib = lib.clone();
        let command = command.clone();
        let future: Pin<Box<dyn Future<Output = Result<Value, String>> + Send>> =
            Box::pin(async move {
                let call = lib.call(&command, &args.to_string())?;
                call.await
            });
        future
    })
}

// ---------------------------------------------------------------------------
// 共用 apply 逻辑
// ---------------------------------------------------------------------------

/// 把命令注册进 CommandRegistry 服务，并登记处置时的注销清理。
async fn apply_commands(
    ctx: &Context,
    plugin_id: &str,
    handlers: HashMap<String, BoxedHandler>,
) -> Result<(), RuntimeError> {
    let registry = ctx
        .try_service::<CommandRegistry>()
        .map_err(|e| RuntimeError(format!("插件「{plugin_id}」获取命令注册表失败: {e}")))?;

    // 插件 Fiber 处置时从注册表移除本插件命令（尽力清理；dll 本身不卸载）
    let registry_for_cleanup = registry.clone();
    let plugin_id_for_cleanup = plugin_id.to_string();
    ctx.effect_sync(move || {
        registry_for_cleanup.unregister(&plugin_id_for_cleanup);
    })
    .map_err(|e| RuntimeError(format!("插件「{plugin_id}」登记清理失败: {e}")))?;

    registry.register(plugin_id, handlers);
    Ok(())
}
