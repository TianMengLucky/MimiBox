//! cordis 服务：命令注册表与账号就绪标记。

use std::collections::HashMap;
use std::sync::RwLock;

use cordis::Service;
use mimibox_plugin::{BoxedHandler, BoxFuture, InvokeCtx};
use serde_json::Value;

/// 命令注册表服务：`"<插件id>::<命令名>" -> handler`。
///
/// 内置插件与磁盘插件在各自 cordis apply 阶段把命令注册进来；
/// 网关命令 `plugin_invoke` 统一经此分发。命令 handler 类型与
/// 插件 SDK 的 Registry 一致（JSON 入参 → JSON 出参的异步函数）。
pub struct CommandRegistry {
    commands: RwLock<HashMap<String, BoxedHandler>>,
}

impl CommandRegistry {
    pub(crate) fn new() -> Self {
        Self {
            commands: RwLock::new(HashMap::new()),
        }
    }

    /// 注册一个插件的全部命令（同名命令覆盖，支持插件重启场景）
    pub(crate) fn register(&self, plugin_id: &str, commands: HashMap<String, BoxedHandler>) {
        let mut map = self.commands.write().unwrap();
        for (name, handler) in commands {
            map.insert(format!("{plugin_id}::{name}"), handler);
        }
    }

    /// 注销一个插件的全部命令（插件 Fiber 处置时经 effect 清理）
    pub(crate) fn unregister(&self, plugin_id: &str) {
        let prefix = format!("{plugin_id}::");
        self.commands
            .write()
            .unwrap()
            .retain(|key, _| !key.starts_with(&prefix));
    }

    /// 分发一条命令；命令不存在时返回错误
    pub fn dispatch(
        &self,
        ctx: InvokeCtx,
        plugin_id: &str,
        command: &str,
        args: Value,
    ) -> Result<BoxFuture, String> {
        let key = format!("{plugin_id}::{command}");
        let handler = self
            .commands
            .read()
            .unwrap()
            .get(&key)
            .cloned()
            .ok_or_else(|| format!("命令「{key}」不存在"))?;
        Ok(handler(ctx, args))
    }
}

impl Service for CommandRegistry {
    const NAME: &'static str = "mimibox.commands";
}

/// 账号服务就绪标记：磁盘插件以 `requires: ["account"]` 依赖它，
/// 在账号状态初始化完成前保持 Pending（cordis 自动收敛）。
///
/// 账号状态（`AccountState`）在 setup 阶段同步初始化、先于任何插件 spawn，
/// 因此 core 插件发布本服务即代表账号数据可用。
pub struct AccountReady;

impl Service for AccountReady {
    const NAME: &'static str = "account";
}

/// 宿主侧统一错误类型（cordis Plugin::ApplyError 要求 std::error::Error）
#[derive(Debug)]
pub struct RuntimeError(pub String);

impl std::fmt::Display for RuntimeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for RuntimeError {}
