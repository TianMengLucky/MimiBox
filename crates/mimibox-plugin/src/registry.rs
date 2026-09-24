//! 命令注册表：插件向宿主声明可调用的命令（原 `#[tauri::command]` 的插件化等价物）。
//!
//! handler 统一为「JSON 入参 → JSON 出参」的异步函数，由 SDK 提供
//! [`Registry::handle`] 做类型化包装（args 反序列化 / result 序列化），
//! 行为对齐原 `#[tauri::command]` 的 serde camelCase 约定。

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;

use crate::host::HostApi;

/// 命令执行上下文：持有宿主能力句柄
pub struct InvokeCtx {
    pub host: Arc<dyn HostApi>,
}

/// 已擦除类型的命令 future
pub type BoxFuture = Pin<Box<dyn Future<Output = Result<Value, String>> + Send>>;
/// 已擦除类型的命令 handler
pub type BoxedHandler = Arc<dyn Fn(InvokeCtx, Value) -> BoxFuture + Send + Sync>;

/// 插件命令注册表
#[derive(Default)]
pub struct Registry {
    commands: HashMap<String, BoxedHandler>,
}

impl Registry {
    pub fn new() -> Self {
        Self::default()
    }

    /// 取出全部命令（宿主侧合并内置插件命令到命令注册表服务时使用）
    pub fn into_commands(self) -> HashMap<String, BoxedHandler> {
        self.commands
    }

    /// 已注册的命令名（按字母排序，用于宿主侧命令清单展示）
    pub fn command_names(&self) -> Vec<String> {
        let mut names: Vec<String> = self.commands.keys().cloned().collect();
        names.sort();
        names
    }

    /// 分发一条命令；命令不存在时返回错误
    pub fn dispatch(&self, ctx: InvokeCtx, command: &str, args: Value) -> Result<BoxFuture, String> {
        let handler = self
            .commands
            .get(command)
            .ok_or_else(|| format!("命令「{command}」不存在"))?;
        Ok(handler(ctx, args))
    }

    /// 注册类型化异步命令：
    /// - `args` JSON 反序列化为 `T`（对齐原命令的参数结构体）；
    /// - 返回 `R` 序列化为 JSON（camelCase 由各类型的 `serde(rename_all)` 保证）。
    pub fn handle<T, R, F, Fut>(&mut self, name: &str, handler: F)
    where
        T: DeserializeOwned + Send + 'static,
        R: Serialize + Send + 'static,
        F: Fn(InvokeCtx, T) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<R, String>> + Send + 'static,
    {
        let handler = Arc::new(handler);
        self.commands.insert(
            name.to_string(),
            Arc::new(move |ctx, raw| {
                let handler = handler.clone();
                Box::pin(async move {
                    let args: T = serde_json::from_value(raw)
                        .map_err(|e| format!("参数解析失败: {e}"))?;
                    let result = handler(ctx, args).await?;
                    serde_json::to_value(result).map_err(|e| e.to_string())
                })
            }),
        );
    }
}
