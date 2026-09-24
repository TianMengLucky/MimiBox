//! 内置插件：与磁盘插件实现同一 [`mimibox_plugin::PluginBackend`] 接口，
//! 由宿主在进程内直接注册（不走 dll FFI），handler 代码完全一致。
//!
//! - [`core`]：发布命令注册表与账号就绪服务（宿主基础设施，无命令）
//! - [`account`]：账号管理（B 站 + 抖音）17 个命令
//! - [`scheme_io`]：方案导入导出 2 个命令（跨插件共用）

pub mod account;
pub mod core;
pub mod scheme_io;

use cordis::{Context, FiberHandle, PreparedPlugin};

use crate::runtime::adapter::BuiltinPlugin;
use crate::runtime::services::RuntimeError;

/// 发布基础设施服务（core 插件：命令注册表 + 账号就绪标记）。
/// 必须最先 spawn，其余插件依赖其发布的 `mimibox.commands` 服务。
pub(crate) async fn spawn_infra(root: &Context) -> Result<FiberHandle, RuntimeError> {
    let prepared = PreparedPlugin::from_input(core::CorePlugin, ());
    root.spawn(prepared)
        .await
        .map_err(|e| RuntimeError(format!("插件基础设施启动失败: {e}")))
}

/// spawn 一个内置插件（经 [`BuiltinPlugin`] 适配为 cordis 插件）
pub(crate) async fn spawn_builtin<P: mimibox_plugin::PluginBackend>(
    root: &Context,
    id: &'static str,
    requires: &'static [&'static str],
    plugin: P,
) -> Result<FiberHandle, RuntimeError> {
    let prepared = PreparedPlugin::from_input(
        BuiltinPlugin {
            id,
            requires,
            plugin,
        },
        (),
    );
    root.spawn(prepared)
        .await
        .map_err(|e| RuntimeError(format!("内置插件「{id}」启动失败: {e}")))
}
