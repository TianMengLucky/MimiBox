pub mod account;
pub mod douyin_signer;
pub mod douyin_web;

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde_json::json;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State};

struct AppState {
    first_launch: Mutex<bool>,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法解析应用数据目录: {e}"))?;
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("无法创建数据目录 {}: {e}", dir.display()))?;
    }
    Ok(dir.join("config.json"))
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            is_first_launch,
            mark_welcome_seen,
            account::account_get_status,
            account::account_list,
            account::account_switch,
            account::account_remove,
            account::account_open_web,
            account::account_qr_start,
            account::account_qr_poll,
            account::account_captcha,
            account::account_sms_send,
            account::account_sms_login,
            account::account_logout,
            account::douyin_qr_start,
            account::douyin_qr_poll,
            account::douyin_qr_sms_send,
            account::douyin_qr_sms_validate,
            account::douyin_reset_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 系统托盘：右键菜单（显示主窗口 / 退出），左键单击显示并聚焦主窗口。
fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let icon = Image::from_bytes(include_bytes!("../icons/icon.png"))?;

    TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .tooltip("美美工具箱")
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
