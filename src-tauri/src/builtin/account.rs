//! account 内置插件：把原 Tauri 静态命令原样注册为插件命令。
//!
//! 命令实现（`account::{manage,bilibili,douyin}`）保持不变；本插件只做
//! 「命令名 + 参数结构」的注册桥接，`State<'_, AccountState>` 经
//! `app.state()` 取得，行为与原 `#[tauri::command]` 完全一致。

use serde::Deserialize;
use tauri::{AppHandle, Manager};

use mimibox_plugin::{InvokeCtx, PluginBackend, Registry};

use crate::account::{
    account_captcha, account_copy_cookie, account_get_status, account_list, account_logout,
    account_open_web, account_qr_poll, account_qr_start, account_sms_login, account_sms_send,
    account_switch, douyin_open_web, douyin_qr_poll, douyin_qr_sms_send, douyin_qr_sms_validate,
    douyin_qr_start, douyin_reset_session, AccountState,
};

/// account_switch 入参
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SwitchArgs {
    mid: String,
}

/// account_qr_poll 入参
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct QrPollArgs {
    qrcode_key: String,
}

/// account_sms_send 入参
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SmsSendArgs {
    tel: String,
    token: String,
    challenge: String,
    validate: String,
    seccode: String,
}

/// account_sms_login 入参
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SmsLoginArgs {
    tel: String,
    code: String,
    captcha_key: String,
}

/// douyin_qr_sms_validate 入参
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct DouyinSmsValidateArgs {
    code: String,
}

/// 账号管理内置插件（进程内直连 AccountState）
pub(crate) struct AccountPlugin {
    app: AppHandle,
}

impl AccountPlugin {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

/// 生成无参命令的注册闭包：每次调用克隆一份 AppHandle，
/// state 借用与 app 克隆都发生在 async 块内部（Send 约束满足）。
macro_rules! command_no_args {
    ($reg:expr, $app:expr, $name:literal, $fun:path) => {
        let app = $app.clone();
        $reg.handle($name, move |_: InvokeCtx, _: ()| {
            let app = app.clone();
            async move {
                let state = app.state::<AccountState>();
                $fun(app.clone(), state).await
            }
        });
    };
}

impl PluginBackend for AccountPlugin {
    fn register(&self, reg: &mut Registry) {
        // 跨平台账号管理
        command_no_args!(reg, self.app, "account_get_status", account_get_status);
        command_no_args!(reg, self.app, "account_list", account_list);
        command_no_args!(reg, self.app, "account_copy_cookie", account_copy_cookie);
        command_no_args!(reg, self.app, "account_logout", account_logout);

        // B 站登录与多账号
        {
            let app = self.app.clone();
            reg.handle("account_switch", move |_: InvokeCtx, args: SwitchArgs| {
                let app = app.clone();
                async move {
                    let state = app.state::<AccountState>();
                    account_switch(app.clone(), state, args.mid).await
                }
            });
        }
        command_no_args!(reg, self.app, "account_open_web", account_open_web);
        {
            let app = self.app.clone();
            reg.handle(
                "account_qr_start",
                move |_: InvokeCtx, _: ()| {
                    let app = app.clone();
                    async move {
                        let state = app.state::<AccountState>();
                        account_qr_start(state).await
                    }
                },
            );
        }
        {
            let app = self.app.clone();
            reg.handle(
                "account_qr_poll",
                move |_: InvokeCtx, args: QrPollArgs| {
                    let app = app.clone();
                    async move {
                        let state = app.state::<AccountState>();
                        account_qr_poll(app.clone(), state, args.qrcode_key).await
                    }
                },
            );
        }
        {
            let app = self.app.clone();
            reg.handle(
                "account_captcha",
                move |_: InvokeCtx, _: ()| {
                    let app = app.clone();
                    async move {
                        let state = app.state::<AccountState>();
                        account_captcha(state).await
                    }
                },
            );
        }
        {
            let app = self.app.clone();
            reg.handle(
                "account_sms_send",
                move |_: InvokeCtx, args: SmsSendArgs| {
                    let app = app.clone();
                    async move {
                        let state = app.state::<AccountState>();
                        account_sms_send(
                            state,
                            args.tel,
                            args.token,
                            args.challenge,
                            args.validate,
                            args.seccode,
                        )
                        .await
                    }
                },
            );
        }
        {
            let app = self.app.clone();
            reg.handle(
                "account_sms_login",
                move |_: InvokeCtx, args: SmsLoginArgs| {
                    let app = app.clone();
                    async move {
                        let state = app.state::<AccountState>();
                        account_sms_login(app.clone(), state, args.tel, args.code, args.captcha_key)
                            .await
                    }
                },
            );
        }

        // 抖音登录
        {
            let app = self.app.clone();
            reg.handle(
                "douyin_reset_session",
                move |_: InvokeCtx, _: ()| {
                    let app = app.clone();
                    async move {
                        let state = app.state::<AccountState>();
                        douyin_reset_session(state).await
                    }
                },
            );
        }
        command_no_args!(reg, self.app, "douyin_open_web", douyin_open_web);
        {
            let app = self.app.clone();
            reg.handle(
                "douyin_qr_start",
                move |_: InvokeCtx, _: ()| {
                    let app = app.clone();
                    async move {
                        let state = app.state::<AccountState>();
                        douyin_qr_start(state).await
                    }
                },
            );
        }
        command_no_args!(reg, self.app, "douyin_qr_poll", douyin_qr_poll);
        {
            let app = self.app.clone();
            reg.handle(
                "douyin_qr_sms_send",
                move |_: InvokeCtx, _: ()| {
                    let app = app.clone();
                    async move {
                        let state = app.state::<AccountState>();
                        douyin_qr_sms_send(state).await
                    }
                },
            );
        }
        {
            let app = self.app.clone();
            reg.handle(
                "douyin_qr_sms_validate",
                move |_: InvokeCtx, args: DouyinSmsValidateArgs| {
                    let app = app.clone();
                    async move {
                        let state = app.state::<AccountState>();
                        douyin_qr_sms_validate(state, args.code).await
                    }
                },
            );
        }
    }
}
