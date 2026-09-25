//! 插件导入管理：从文件夹或 `.mip` 包（zip 格式）导入第三方插件。
//!
//! 导入目标为用户插件目录（应用数据目录 `plugins/`），加载器按
//! 「用户目录覆盖内置目录」合并加载。导入新 id 的插件后经
//! [`plugin_reload`] 热加载，无需重启；升级/替换同 id 插件与删除
//! 已加载插件受 Windows dll 锁限制，仍需重启应用。只有用户目录中
//! 的插件可以删除；导入包是信任代码，不做沙箱。

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::loader::{user_plugins_dir, valid_id, PluginManifest};
use mimibox_plugin::MB_ABI_VERSION;

/// 复制/解压插件包时排除的构建缓存与系统垃圾。注意：源码分发包的
/// `backend/` 目录与 `Cargo.toml` 是包正文（现场编译用），不能排除；
/// `backend/target` 等构建缓存由 "target" 规则覆盖。
const EXCLUDE_NAMES: &[&str] = &["target", ".git", "node_modules", "__MACOSX", ".DS_Store"];

/// mip 包内条目的公共前缀
struct MipLayout {
    /// 剥离的前缀（根布局为 ""，单层目录布局为 "<dir>/"）
    prefix: String,
}

/// 插件存放设置（plugin_settings.json）：自定义目录为空时用默认位置
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PluginSettings {
    custom_dir: Option<String>,
}

const SETTINGS_FILE: &str = "plugin_settings.json";

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(crate::scheme_store::data_dir(app)?.join(SETTINGS_FILE))
}

fn load_settings(app: &AppHandle) -> PluginSettings {
    let path = match settings_path(app) {
        Ok(path) => path,
        Err(_) => return PluginSettings::default(),
    };
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save_settings(app: &AppHandle, settings: &PluginSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| format!("无法写入 {path:?}: {e}"))?;
    Ok(())
}

/// 当前生效的用户插件目录：设置中自定义的目录，未设置时为默认位置。
/// 加载器、导入、mbplugin:// 协议都以这里为准；修改目录用
/// [`plugin_set_dir`]（自动迁移已导入插件并提示重启）。
pub fn effective_user_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let settings = load_settings(app);
    match settings
        .custom_dir
        .filter(|dir| !dir.trim().is_empty())
    {
        Some(dir) => Ok(PathBuf::from(dir)),
        None => user_plugins_dir(app),
    }
}


#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginDirInfo {
    /// 当前生效目录
    pub current: String,
    /// 用户自定义目录；未自定义时为 null
    pub custom_dir: Option<String>,
    /// 默认目录（应用数据目录 plugins/）
    pub default_dir: String,
    /// 是否处于自定义状态
    pub is_custom: bool,
}

fn dir_info(app: &AppHandle) -> Result<PluginDirInfo, String> {
    let settings = load_settings(app);
    let default_dir = user_plugins_dir(app)?;
    let custom = settings
        .custom_dir
        .filter(|dir| !dir.trim().is_empty());
    Ok(PluginDirInfo {
        current: custom
            .clone()
            .unwrap_or_else(|| default_dir.display().to_string()),
        is_custom: custom.is_some(),
        custom_dir: custom,
        default_dir: default_dir.display().to_string(),
    })
}

/// 移动一个插件目录到目标位置：同盘 rename，跨盘回退为复制 + 删除
fn move_dir(source: &Path, target: &Path) -> Result<(), String> {
    if fs::rename(source, target).is_ok() {
        return Ok(());
    }
    fs::create_dir_all(target).map_err(|e| format!("无法创建 {target:?}: {e}"))?;
    copy_dir_contents(source, target)?;
    fs::remove_dir_all(source).map_err(|e| format!("无法清理 {source:?}: {e}"))?;
    Ok(())
}

/// 把旧目录下全部插件目录迁移到新目录；目标同名目录按升级语义覆盖。
/// 插件 dll 被占用（应用运行中）时报可操作的错误。
fn migrate_user_plugins(old: &Path, new: &Path) -> Result<usize, String> {
    if !old.is_dir() || old == new {
        return Ok(0);
    }
    let mut migrated = 0usize;
    for entry in fs::read_dir(old).map_err(|e| format!("无法读取 {old:?}: {e}"))? {
        let entry = entry.map_err(|e| format!("读取目录失败: {e}"))?;
        let dir = entry.path();
        if !dir.is_dir() || !dir.join("plugin.json").exists() {
            continue;
        }
        let id = dir
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let dest = new.join(&id);
        if dest.exists() {
            fs::remove_dir_all(&dest).map_err(|_| {
                format!("目标位置已存在「{id}」且正在使用中：请重启应用后再修改插件目录")
            })?;
        }
        move_dir(&dir, &dest).map_err(|e| {
            format!("迁移插件「{id}」失败：{e}（可能插件正在使用中，请重启应用后重试）")
        })?;
        migrated += 1;
    }
    Ok(migrated)
}

/// 读取当前插件目录信息（设置页展示）
#[tauri::command]
pub fn plugin_get_dir(app: AppHandle) -> Result<PluginDirInfo, String> {
    dir_info(&app)
}

/// 设置用户插件存放位置：`path` 为 `null` 时恢复默认位置。
/// 已导入的插件会自动迁移到新位置（目标同名插件按升级语义覆盖），
/// 修改后需要重启应用生效。
#[tauri::command]
pub fn plugin_set_dir(app: AppHandle, path: Option<String>) -> Result<PluginDirInfo, String> {
    let custom = path
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty());

    let old_dir = effective_user_dir(&app)?;
    let new_dir = match &custom {
        Some(dir) => {
            let dir = PathBuf::from(dir);
            fs::create_dir_all(&dir).map_err(|e| format!("无法使用该目录: {e}"))?;
            // 规范化（解析大小写与相对段），需要目录已存在
            dir.canonicalize().unwrap_or(dir)
        }
        None => user_plugins_dir(&app)?,
    };

    // 迁移旧目录中的全部插件（数量当前不向前端展示）
    migrate_user_plugins(&old_dir, &new_dir)?;
    save_settings(
        &app,
        &PluginSettings {
            custom_dir: custom.clone(),
        },
    )?;
    dir_info(&app)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOutcome {
    pub manifest: PluginManifest,
    /// 用户插件目录中该插件的位置
    pub installed_path: String,
}

/// 读取并校验插件目录的清单：id 合法、ABI 匹配、后端入口非空。
/// 不检查产物文件——源码分发包导入时产物尚不存在，编译在
/// [`crate::import_build::ensure_built`] 进行。
fn parse_manifest(plugin_dir: &Path) -> Result<PluginManifest, String> {
    let text = fs::read_to_string(plugin_dir.join("plugin.json"))
        .map_err(|e| format!("缺少或无法读取 plugin.json: {e}"))?;
    let manifest: PluginManifest =
        serde_json::from_str(&text).map_err(|e| format!("plugin.json 解析失败: {e}"))?;
    if !valid_id(&manifest.id) {
        return Err("插件 id 只允许字母/数字/-/_".to_string());
    }
    if manifest.abi != MB_ABI_VERSION {
        return Err(format!(
            "ABI 版本不匹配（插件 {}，宿主 {MB_ABI_VERSION}），请联系插件作者适配当前应用版本",
            manifest.abi
        ));
    }
    if manifest.entry.backend.is_empty() {
        return Err("清单缺少 entry.backend（后端动态库入口）".to_string());
    }
    Ok(manifest)
}

/// 校验后端动态库产物已存在（编译/复制完成后调用）
fn verify_backend(plugin_dir: &Path, manifest: &PluginManifest) -> Result<(), String> {
    if !plugin_dir.join(&manifest.entry.backend).is_file() {
        return Err(format!("后端库缺失: {}", manifest.entry.backend));
    }
    Ok(())
}

/// 目标插件目录：用户目录/<id>；已存在（升级导入）时清空旧内容。
/// 目录被占用（dll 已加载）时给出可操作的错误提示。
fn prepare_target(user_dir: &Path, id: &str) -> Result<PathBuf, String> {
    let target = user_dir.join(id);
    if target.exists() {
        fs::remove_dir_all(&target).map_err(|_| {
            format!("插件「{id}」正在使用中，无法覆盖：请先重启应用，再重新导入")
        })?;
    }
    fs::create_dir_all(&target)
        .map_err(|e| format!("无法创建插件目录 {}: {e}", target.display()))?;
    Ok(target)
}

/// 递归复制目录内容，跳过分发无关文件/目录（EXCLUDE_NAMES）
fn copy_dir_contents(source: &Path, target: &Path) -> Result<(), String> {
    for entry in fs::read_dir(source).map_err(|e| format!("无法读取 {source:?}: {e}"))? {
        let entry = entry.map_err(|e| format!("读取目录失败: {e}"))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if EXCLUDE_NAMES.iter().any(|ex| name.eq_ignore_ascii_case(ex)) {
            continue;
        }
        let dest = target.join(&name);
        let path = entry.path();
        if path.is_dir() {
            fs::create_dir_all(&dest).map_err(|e| format!("无法创建 {dest:?}: {e}"))?;
            copy_dir_contents(&path, &dest)?;
        } else {
            fs::copy(&path, &dest)
                .map_err(|e| format!("无法复制 {path:?}: {e}"))?;
        }
    }
    Ok(())
}

/// 从文件夹导入：校验 `<folder>/plugin.json` 后整体复制到用户插件目录；
/// 含源码（backend/Cargo.toml、frontend/index.tsx）且缺产物时现场编译
#[tauri::command]
pub async fn plugin_import_folder(app: AppHandle, path: String) -> Result<ImportOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || import_folder_impl(app, path))
        .await
        .map_err(|e| format!("导入任务执行失败: {e}"))?
}

fn import_folder_impl(app: AppHandle, path: String) -> Result<ImportOutcome, String> {
    let source = PathBuf::from(&path);
    if !source.is_dir() {
        return Err("插件文件夹不存在，请重新选择".to_string());
    }
    let manifest = parse_manifest(&source)?;
    let user_dir = effective_user_dir(&app)?;
    let target = prepare_target(&user_dir, &manifest.id)?;
    copy_dir_contents(&source, &target)?;
    // 复制后复核清单（复制过程中文件损坏的兜底校验）
    parse_manifest(&target)?;
    // 源码分发包现场编译缺失产物（含预构建产物的包直接跳过）
    let build_dir = user_dir.join(format!(".mb-build-{}", std::process::id()));
    crate::import_build::ensure_built(&app, &target, &manifest, &build_dir)?;
    verify_backend(&target, &manifest)?;
    Ok(ImportOutcome {
        manifest,
        installed_path: target.display().to_string(),
    })
}

/// 规范化 zip 条目路径并防 zip-slip：拒绝绝对路径与 `..` 上跳
fn safe_entry_name(name: &str) -> Option<String> {
    let name = name.replace('\\', "/");
    if name.starts_with('/') || name.contains(':') || name.split('/').any(|seg| seg == "..") {
        return None;
    }
    Some(name)
}

/// 探测 mip 包布局：根布局（plugin.json 在包根）或单层目录布局
/// （`<dir>/plugin.json`），返回需剥离的前缀
fn detect_mip_layout<R: Read + std::io::Seek>(
    zip: &mut zip::ZipArchive<R>,
) -> Result<MipLayout, String> {
    if zip.by_name("plugin.json").is_ok() {
        return Ok(MipLayout { prefix: String::new() });
    }
    let mut candidates: Vec<String> = Vec::new();
    for index in 0..zip.len() {
        let entry = zip
            .by_index(index)
            .map_err(|e| format!("无法读取插件包内容: {e}"))?;
        let Some(name) = safe_entry_name(entry.name()) else {
            continue;
        };
        if name.ends_with("/plugin.json") {
            candidates.push(name[..name.len() - "plugin.json".len()].to_string());
        }
    }
    candidates.sort();
    candidates.dedup();
    match candidates.as_slice() {
        [prefix] => Ok(MipLayout { prefix: prefix.clone() }),
        [] => Err("不是有效的 MimiBox 插件包：缺少 plugin.json".to_string()),
        _ => Err("插件包结构无效：存在多个 plugin.json，无法确定插件根目录".to_string()),
    }
}

/// 从 .mip 包（zip）导入：探测布局 → 解压到暂存目录 → 校验清单 →
/// 源码现场编译 → 落位
#[tauri::command]
pub async fn plugin_import_mip(app: AppHandle, path: String) -> Result<ImportOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || import_mip_impl(app, path))
        .await
        .map_err(|e| format!("导入任务执行失败: {e}"))?
}

fn import_mip_impl(app: AppHandle, path: String) -> Result<ImportOutcome, String> {
    let file = fs::File::open(&path).map_err(|e| format!("无法打开插件包: {e}"))?;
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|_| "不是有效的 zip 插件包".to_string())?;
    let layout = detect_mip_layout(&mut zip)?;

    // 先解压到暂存目录：校验通过后才落位，避免半成品插件残留在用户目录
    let user_dir = effective_user_dir(&app)?;
    let staging = user_dir.join(format!(".import-staging-{}", std::process::id()));
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(|e| format!("无法清理暂存目录: {e}"))?;
    }
    fs::create_dir_all(&staging).map_err(|e| format!("无法创建暂存目录: {e}"))?;

    let result = (|| -> Result<PluginManifest, String> {
        for index in 0..zip.len() {
            let mut entry = zip
                .by_index(index)
                .map_err(|e| format!("无法读取插件包内容: {e}"))?;
            let Some(name) = safe_entry_name(entry.name()) else {
                continue;
            };
            let Some(relative) = name.strip_prefix(&layout.prefix) else {
                continue;
            };
            if relative.is_empty() {
                continue;
            }
            // 跳过分发无关内容
            let segments: Vec<&str> = relative.split('/').collect();
            if segments
                .iter()
                .any(|seg| EXCLUDE_NAMES.iter().any(|ex| seg.eq_ignore_ascii_case(ex)))
            {
                continue;
            }
            let dest = staging.join(relative);
            if entry.is_dir() {
                fs::create_dir_all(&dest).map_err(|e| format!("无法创建 {dest:?}: {e}"))?;
                continue;
            }
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("无法创建 {parent:?}: {e}"))?;
            }
            let mut buffer = Vec::new();
            entry
                .read_to_end(&mut buffer)
                .map_err(|e| format!("读取包内 {name} 失败: {e}"))?;
            fs::write(&dest, buffer).map_err(|e| format!("写入 {dest:?} 失败: {e}"))?;
        }
        parse_manifest(&staging)
    })();

    let manifest = match result {
        Ok(manifest) => manifest,
        Err(e) => {
            let _ = fs::remove_dir_all(&staging);
            return Err(e);
        }
    };

    // 源码分发包现场编译缺失产物（含预构建产物的包直接跳过）
    let build_dir = user_dir.join(format!(".mb-build-{}", std::process::id()));
    if let Err(e) = crate::import_build::ensure_built(&app, &staging, &manifest, &build_dir) {
        let _ = fs::remove_dir_all(&staging);
        return Err(e);
    }
    if let Err(e) = verify_backend(&staging, &manifest) {
        let _ = fs::remove_dir_all(&staging);
        return Err(e);
    }

    // 校验通过：落位（同 id 视为升级，覆盖旧内容）
    let target = user_dir.join(&manifest.id);
    if target.exists() {
        fs::remove_dir_all(&target).map_err(|_| {
            format!(
                "插件「{}」正在使用中，无法覆盖：请先重启应用，再重新导入",
                manifest.id
            )
        })?;
    }
    fs::rename(&staging, &target)
        .map_err(|e| format!("无法安装插件到 {}: {e}", target.display()))?;

    Ok(ImportOutcome {
        manifest,
        installed_path: target.display().to_string(),
    })
}

/// 删除一个用户导入的插件：先热卸载（停止插件 Fiber 并注销命令，即时
/// 生效），再删除插件目录。dll 文件按设计驻留内存（不主动 FreeLibrary），
/// 若删除时仍被占用，则把目录改名隔离为 `.trash-*`，剩余文件由下次
/// 启动时的 [`cleanup_user_dir_trash`] 清理。
#[tauri::command]
pub async fn plugin_remove(app: AppHandle, id: String) -> Result<(), String> {
    use tauri::Emitter;

    if !valid_id(&id) {
        return Err("无效的插件 id".to_string());
    }
    let user_dir = effective_user_dir(&app)?;
    let dir = user_dir.join(&id);
    if !dir.is_dir() {
        return Err("该插件不是用户导入的插件（随应用分发的插件不可删除）".to_string());
    }

    // 1. 热卸载：停止插件 Fiber 并从运行时清单移除（尚未加载时跳过）
    if let Some(runtime) = app.try_state::<crate::runtime::MbRuntime>() {
        runtime.stop_plugin(&id).await;
    }

    // 2. 删除目录；backend.dll 仍驻留内存时改名隔离，留给下次启动清理
    if let Err(_e) = fs::remove_dir_all(&dir) {
        let trash = user_dir.join(format!(".trash-{}-{}", id, std::process::id()));
        let _ = fs::remove_dir_all(&trash);
        fs::rename(&dir, &trash).map_err(|e| {
            format!("插件「{id}」已停止，但文件清理失败：{e}（请重启应用后重试）")
        })?;
        cleanup_trash_dir(&trash);
    }

    // 3. 广播：前端同步移除对应卡片与功能页
    let _ = app.emit("plugins-changed", &Vec::<String>::new());
    Ok(())
}

/// 清理隔离目录：递归删除其中内容；backend.dll 可能仍被驻留内存的句柄
/// 锁定则忽略失败，留待下次启动清理。
fn cleanup_trash_dir(trash: &Path) {
    let Ok(entries) = fs::read_dir(trash) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let _ = fs::remove_dir_all(&path);
        } else {
            let _ = fs::remove_file(&path);
        }
    }
    let _ = fs::remove_dir(trash);
}

/// 启动时清理上次导入/删除操作留下的暂存目录（`.trash-*` 隔离目录与
/// `.mb-build-*` 编译缓存；此时 dll 尚未加载，可安全删除）
pub fn cleanup_user_dir_trash(app: &AppHandle) {
    let Ok(user_dir) = effective_user_dir(app) else {
        return;
    };
    let Ok(entries) = fs::read_dir(&user_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with(".trash-") || name.starts_with(".mb-build-") {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

/// 热加载结果
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReloadOutcome {
    /// 本次新加载并已生效的插件 id
    pub loaded: Vec<String>,
    /// 加载失败摘要（每插件一条，前端展示）
    pub errors: Vec<String>,
}

/// 热加载新导入的插件：扫描插件目录并加载尚未加载的插件，无需重启。
/// 已加载的插件不受影响（Windows 下运行中的 dll 无法覆盖，
/// 升级/替换同 id 插件仍需重启）。新插件加载完成后广播
/// `plugins-changed` 事件，前端运行时据此加载新插件前端并刷新功能页。
#[tauri::command]
pub async fn plugin_reload(app: AppHandle) -> Result<ReloadOutcome, String> {
    use tauri::Emitter;

    let dirs = crate::loader::plugin_dirs(&app)?;
    let user_dir = dirs[0].clone();
    let runtime = app
        .try_state::<crate::runtime::MbRuntime>()
        .ok_or_else(|| "插件运行时未初始化".to_string())?;
    let (loaded, errors) = runtime.reload_new(&dirs, &user_dir).await;
    if !loaded.is_empty() {
        let _ = app.emit("plugins-changed", &loaded);
    }
    Ok(ReloadOutcome { loaded, errors })
}
