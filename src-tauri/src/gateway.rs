//! 动态网关：前端调用插件命令的唯一入口。
//!
//! 静态命令只剩 `is_first_launch` / `mark_welcome_seen`（宿主自身的
//! 欢迎流程）与本模块的两个网关命令；其余全部命令经
//! `plugin_invoke(plugin, command, args)` 分发到 CommandRegistry 服务。

use serde_json::Value;
use tauri::State;

use crate::runtime::services::CommandRegistry;
use crate::runtime::{MbRuntime, PluginInfo};

/// 分发插件命令：`plugin_invoke("lottery", "lottery_load", null)`。
/// `args` 为命令入参对象；无参命令传 `null`。
#[tauri::command]
pub async fn plugin_invoke(
    runtime: State<'_, MbRuntime>,
    plugin: String,
    command: String,
    args: Option<Value>,
) -> Result<Value, String> {
    let registry = runtime
        .root
        .try_service::<CommandRegistry>()
        .map_err(|e| format!("命令注册表不可用: {e}"))?;
    let ctx = mimibox_plugin::InvokeCtx {
        host: runtime.host.clone(),
    };
    let future = registry.dispatch(ctx, &plugin, &command, args.unwrap_or(Value::Null))?;
    future.await
}

/// 已加载插件清单（前端据此注入脚本、渲染首页卡片与通用功能页）
#[tauri::command]
pub fn plugin_list(runtime: State<'_, MbRuntime>) -> Vec<PluginInfo> {
    runtime.plugin_infos()
}
