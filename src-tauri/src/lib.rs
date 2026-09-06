use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde_json::json;
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![is_first_launch, mark_welcome_seen])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
