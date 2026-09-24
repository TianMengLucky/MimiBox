//! core 内置插件：发布命令注册表（`mimibox.commands`）与账号就绪
//! （`account`）两个宿主服务，自身不注册任何命令。
//!
//! 发布时机即语义：`AccountState` 在 setup 阶段同步初始化、先于任何
//! 插件 spawn，因此 core 的 apply 完成即代表账号数据可用，依赖
//! `requires: ["account"]` 的磁盘插件随后自动收敛为 Active。

use std::convert::Infallible;
use std::sync::Arc;

use cordis::{Context, InjectSpec, Plugin};
use std::borrow::Cow;

use crate::runtime::services::{AccountReady, CommandRegistry, RuntimeError};

pub(crate) struct CorePlugin;

impl Plugin for CorePlugin {
    type Config = ();
    type Input = ();
    type PrepareError = Infallible;
    type ApplyError = RuntimeError;

    fn name(&self) -> Cow<'_, str> {
        Cow::Borrowed("core")
    }

    fn inject(&self) -> InjectSpec {
        InjectSpec::none()
    }

    fn prepare(&self, (): ()) -> Result<(), Infallible> {
        Ok(())
    }

    async fn apply(&self, ctx: Context, _input: &()) -> Result<(), RuntimeError> {
        // 发布能力由插件 Fiber 世代持有（ServicePublication 弃用时清理，
        // 本插件与应用同生命周期，无需手动保留句柄）
        let _ = ctx
            .provide::<CommandRegistry>(Arc::new(CommandRegistry::new()))
            .map_err(|e| RuntimeError(format!("发布命令注册表服务失败: {e}")))?;
        let _ = ctx
            .provide::<AccountReady>(Arc::new(AccountReady))
            .map_err(|e| RuntimeError(format!("发布账号就绪服务失败: {e}")))?;
        Ok(())
    }
}
