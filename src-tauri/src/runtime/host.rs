//! 宿主能力实现：把 Tauri AppHandle 封装成插件 SDK 的 [`HostApi`]。
//!
//! 内置插件经 [`crate::runtime::adapter`] 拿到的是本实现的 Arc；
//! 磁盘插件则通过 [`super::vtable`] 的 FFI 包装间接触达同一实现。

use std::path::PathBuf;

use mimibox_plugin::{BiliCredentials, HostApi, WindowOptions};
use tauri::{AppHandle, Emitter, Manager};

use crate::account::AccountState;
use crate::scheme_store;

/// 进程内直连 AppHandle 的宿主能力实现
pub struct HostImpl {
    app: AppHandle,
}

impl HostImpl {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl HostApi for HostImpl {
    fn data_dir(&self) -> Result<PathBuf, String> {
        scheme_store::data_dir(&self.app)
    }

    fn emit(&self, event: &str, payload: &serde_json::Value) -> Result<(), String> {
        self.app
            .emit(event, payload)
            .map_err(|e| format!("事件「{event}」发送失败: {e}"))
    }

    fn bili_credentials(&self, mid: Option<&str>) -> Result<BiliCredentials, String> {
        let state = self.app.state::<AccountState>();
        let (mid, cookie) = state.bilibili_credentials(&self.app, mid)?;
        Ok(BiliCredentials { mid, cookie })
    }

    fn window_exists(&self, label: &str) -> bool {
        self.app.get_webview_window(label).is_some()
    }

    fn create_window(&self, options: &WindowOptions) -> Result<(), String> {
        use tauri::WebviewUrl;
        if self.window_exists(&options.label) {
            return self.focus_window(&options.label);
        }
        let mut builder = tauri::WebviewWindowBuilder::new(
            &self.app,
            options.label.clone(),
            WebviewUrl::App(options.path.clone().into()),
        )
        .title(options.title.clone())
        .inner_size(options.width, options.height)
        .decorations(options.decorations);
        if let (Some(w), Some(h)) = (options.min_width, options.min_height) {
            builder = builder.min_inner_size(w, h);
        }
        builder
            .build()
            .map_err(|e| format!("创建窗口「{}」失败: {e}", options.label))?;
        Ok(())
    }

    fn focus_window(&self, label: &str) -> Result<(), String> {
        let window = self
            .app
            .get_webview_window(label)
            .ok_or_else(|| format!("窗口「{label}」不存在"))?;
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        Ok(())
    }

    fn reveal_path(&self, path: &str) -> Result<(), String> {
        use tauri_plugin_opener::OpenerExt;
        self.app
            .opener()
            .reveal_item_in_dir(path)
            .map_err(|e| format!("无法在资源管理器中定位 {path}: {e}"))
    }
}
