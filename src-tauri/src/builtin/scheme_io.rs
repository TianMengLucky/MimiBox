//! scheme-io 内置插件：方案导入导出（.miz）两个命令。
//!
//! 读写实现（`crate::scheme_io`）保持不变；作为内置插件注册是为了
//! 各功能插件经网关统一调用（`scheme-io::scheme_io_read/write`），
//! 前端文件对话框仍走 `@tauri-apps/plugin-dialog`。

use serde::Deserialize;
use serde_json::Value;

use mimibox_plugin::{InvokeCtx, PluginBackend, Registry};

use crate::scheme_io::{scheme_io_read, scheme_io_write};

/// scheme_io_write 入参
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct WriteArgs {
    path: String,
    payload: Value,
}

/// scheme_io_read 入参
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ReadArgs {
    path: String,
    kind: String,
}

/// 方案导入导出内置插件
pub(crate) struct SchemeIoPlugin;

impl PluginBackend for SchemeIoPlugin {
    fn register(&self, reg: &mut Registry) {
        reg.handle("scheme_io_write", |_: InvokeCtx, args: WriteArgs| async move {
            scheme_io_write(args.path, args.payload)
        });
        reg.handle("scheme_io_read", |_: InvokeCtx, args: ReadArgs| async move {
            scheme_io_read(args.path, args.kind)
        });
    }
}
