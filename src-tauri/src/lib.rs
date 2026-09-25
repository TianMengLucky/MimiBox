pub mod account;
pub mod builtin;
pub mod douyin_signer;
pub mod douyin_web;
pub mod gateway;
pub mod import_build;
pub mod loader;
pub mod plugin_manager;
mod scheme_store;
pub mod scheme_io;
pub mod runtime;

use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde_json::json;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State};

use runtime::MbRuntime;

struct AppState {
    first_launch: Mutex<bool>,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(scheme_store::data_dir(app)?.join("config.json"))
}

#[tauri::command]
fn is_first_launch(state: State<AppState>) -> bool {
    *state.first_launch.lock().unwrap()
}

#[tauri::command]
fn mark_welcome_seen(app: AppHandle, state: State<AppState>) -> Result<(), String> {
    let path = config_path(&app)?;
    let config = json!({ "first_launch": false });
    fs::write(
        &path,
        serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("无法写入配置文件 {}: {e}", path.display()))?;
    *state.first_launch.lock().unwrap() = false;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // mbplugin:// 自定义协议：向各窗口提供插件前端 bundle 与静态资源
        .register_asynchronous_uri_scheme_protocol("mbplugin", |ctx, request, responder| {
            responder.respond(serve_mbplugin(ctx.app_handle(), &request));
        })
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let first_launch = if dir.join("config.json").exists() {
                false
            } else {
                fs::create_dir_all(&dir)?;
                fs::write(
                    dir.join("config.json"),
                    serde_json::to_string_pretty(&json!({ "first_launch": true }))?,
                )?;
                true
            };
            app.manage(AppState {
                first_launch: Mutex::new(first_launch),
            });
            app.manage(account::init_state(app.handle())?);
            setup_tray(app)?;

            // 插件运行时：cordis 根上下文 + 内置插件 + 磁盘插件加载
            plugin_manager::cleanup_user_dir_trash(app.handle());
            let host = Arc::new(runtime::host::HostImpl::new(app.handle().clone()));
            runtime::vtable::install_host(host.clone())?;
            let plugin_dirs = loader::plugin_dirs(app.handle())?;
            let user_plugins_dir = plugin_manager::effective_user_dir(app.handle())?;
            let root = cordis::Context::new();
            let block_result = tauri::async_runtime::block_on(async {
                // 1. 基础设施：命令注册表 + 账号就绪服务
                builtin::spawn_infra(&root)
                    .await
                    .map_err(|e| format!("{e}"))?;
                // 2. 内置插件：账号管理（17 命令）与方案导入导出（2 命令）
                builtin::spawn_builtin(&root, "account", &[], builtin::account::AccountPlugin::new(app.handle().clone()))
                    .await
                    .map_err(|e| format!("{e}"))?;
                builtin::spawn_builtin(&root, "scheme-io", &[], builtin::scheme_io::SchemeIoPlugin)
                    .await
                    .map_err(|e| format!("{e}"))?;
                // 3. 磁盘插件：单个失败只跳过，不阻断启动
                let (loaded, errors) = loader::load_all(&root, &plugin_dirs, &user_plugins_dir).await;
                Ok::<_, String>((loaded, errors))
            });
            let (loaded, errors) = match block_result {
                Ok(value) => value,
                Err(e) => return Err(Box::<dyn std::error::Error>::from(e)),
            };

            let mb_runtime = MbRuntime::new(root, host, plugin_dirs);
            for item in loaded {
                mb_runtime.add_plugin(item);
            }
            for error in errors {
                eprintln!("[mimibox] {error}");
            }
            app.manage(mb_runtime);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            is_first_launch,
            mark_welcome_seen,
            gateway::plugin_invoke,
            gateway::plugin_list,
            plugin_manager::plugin_import_folder,
            plugin_manager::plugin_import_mip,
            plugin_manager::plugin_reload,
            plugin_manager::plugin_remove,
            plugin_manager::plugin_get_dir,
            plugin_manager::plugin_set_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// mbplugin:// 请求处理：`mbplugin://localhost/<id>/<相对路径>` → 插件目录文件
/// （Windows/Android 实际经 `http://mbplugin.localhost/<路径>` 访问，路径
/// 为百分号编码）。仅允许安全的 id 与相对路径（防目录穿越），JS 用正确
/// MIME 返回。
fn serve_mbplugin(
    app: &AppHandle,
    request: &tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    use percent_encoding::percent_decode_str;

    let not_found = |msg: &str| match tauri::http::Response::builder()
        .status(404)
        .body(msg.as_bytes().to_vec())
    {
        Ok(response) => response,
        Err(_) => tauri::http::Response::new(Vec::new()),
    };
    // convertFileSrc 会把整个相对路径百分号编码（含分隔符），先还原
    let raw_path = request.uri().path().trim_start_matches('/');
    let Ok(decoded) = percent_decode_str(raw_path).decode_utf8() else {
        return not_found("invalid plugin path");
    };
    let Some((id, relative)) = decoded.split_once('/') else {
        return not_found("invalid plugin path");
    };
    if !loader::valid_id(id) || relative.contains("..") || relative.contains('\\') {
        return not_found("invalid plugin path");
    }
    // 按优先级在全部插件目录中查找（用户导入目录优先）
    let dirs = app
        .try_state::<MbRuntime>()
        .map(|runtime| runtime.plugin_dirs.clone())
        .unwrap_or_default();
    for dir in dirs {
        let file = dir.join(id).join(relative);
        if let Ok(data) = fs::read(&file) {
            let mime = match file.extension().and_then(|e| e.to_str()) {
                Some("js" | "mjs") => "text/javascript",
                Some("json") => "application/json",
                Some("css") => "text/css",
                Some("html") => "text/html",
                Some("png") => "image/png",
                Some("svg") => "image/svg+xml",
                _ => "application/octet-stream",
            };
            match tauri::http::Response::builder()
                .header("Content-Type", mime)
                .body(data)
            {
                Ok(response) => return response,
                Err(_) => return not_found("response build failed"),
            }
        }
    }
    not_found("plugin asset not found")
}

/// 系统托盘：右键菜单（显示主窗口 / 退出），左键单击显示并聚焦主窗口。
fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let icon = Image::from_bytes(include_bytes!("../icons/icon.png"))?;

    TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .tooltip("美美工具箱 X")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
