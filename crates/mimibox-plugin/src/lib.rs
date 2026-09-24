//! MimiBox 插件 SDK：宿主与插件共用的 C ABI、命令注册与持久化工具。
//!
//! # 插件视角
//!
//! 一个插件 = 一组类型化 DTO + 一个 [`PluginBackend`] 实现：
//!
//! ```ignore
//! // plugins/<id>/backend/src/lib.rs
//! use mimibox_plugin::{export_plugin, Registry, InvokeCtx, store};
//!
//! #[derive(serde::Serialize, serde::Deserialize, Default)]
//! #[serde(rename_all = "camelCase")]
//! struct MyData { items: Vec<String> }
//!
//! struct MyPlugin;
//!
//! impl mimibox_plugin::PluginBackend for MyPlugin {
//!     fn register(&self, reg: &mut Registry) {
//!         reg.handle("my_load", |ctx: InvokeCtx, _args: ()| async move {
//!             store::load::<MyData>(&*ctx.host, "my.json", "我的数据")
//!         });
//!         reg.handle("my_save", |ctx: InvokeCtx, args: MyData| async move {
//!             store::save(&*ctx.host, "my.json", "我的数据", &args)
//!         });
//!     }
//! }
//!
//! export_plugin!(MyPlugin);
//! ```
//!
//! # 内置插件
//!
//! 宿主内置插件（account、scheme-io）实现同一 [`PluginBackend`]，
//! 由宿主在进程内直接注册（不走 FFI），handler 代码完全一致。

pub mod abi;
pub mod ffi;
pub mod host;
pub mod registry;
pub mod store;

pub use abi::MB_ABI_VERSION;
pub use host::{BiliCredentials, HostApi, LogLevel, WindowOptions};
pub use registry::{BoxedHandler, BoxFuture, InvokeCtx, Registry};
pub use serde_json;
pub use tokio;

/// 插件后端：进程内（内置插件）与 dll 插件共用的注册接口。
///
/// `register` 中调用 [`Registry::handle`] 声明命令；宿主在加载时
/// （FFI `mb_plugin_register` 或进程内直接调用）执行一次。
pub trait PluginBackend: Send + Sync + 'static {
    fn register(&self, registry: &mut Registry);
}
