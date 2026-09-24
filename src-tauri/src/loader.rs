//! 磁盘插件加载器：扫描插件目录 → 解析清单 → 校验 ABI → FFI 注册 →
//! 包装为 cordis 插件 spawn。
//!
//! 目录约定：`Plugins/<id>/` 下有 `plugin.json`（清单）、
//! `backend/`（Rust 源码，workspace 成员）与构建产物
//! `backend.dll` + `frontend/index.js`（由 `scripts/build-plugins.mjs` 生成）。
//! 扫描按目录优先级合并：**用户导入目录（应用数据目录 plugins/）覆盖内置
//! 目录**（开发态仓库根 `Plugins/`、发布态资源目录）——同名 id 只加载一份，
//! 允许用户用导入的插件升级/替换随应用分发的版本。
//! 单个插件加载失败只记录错误并跳过，不阻断应用启动。

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use cordis::{Context, FiberHandle, PreparedPlugin};
use mimibox_plugin::MB_ABI_VERSION;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::runtime::adapter::{DiskPlugin, PluginLibrary};

/// 插件清单（`Plugins/<id>/plugin.json`）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    /// 插件唯一标识（字母/数字/-/_，同时用于命令前缀与协议路径）
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub emoji: String,
    #[serde(default)]
    pub description: String,
    /// 首页卡片分类：video（视频制作）/ fun（娱乐功能）
    #[serde(default)]
    pub category: String,
    /// 插件 ABI 版本，必须与宿主一致才会加载
    pub abi: u32,
    /// 插件独立版本（CI 增量发布与 .mip 分发对比用）
    #[serde(default)]
    pub version: String,
    /// 依赖的宿主服务（如 "account"），未就绪时插件保持 Pending
    #[serde(default)]
    pub requires: Vec<String>,
    #[serde(default)]
    pub entry: PluginEntry,
}

/// 插件入口文件（相对插件目录）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginEntry {
    /// 后端动态库（如 "backend.dll"）
    #[serde(default)]
    pub backend: String,
    /// 前端 bundle（如 "frontend/index.js"），留空表示纯后端插件
    #[serde(default)]
    pub frontend: String,
}

/// 一个已成功 spawn 的磁盘插件（宿主运行时登记用）
pub(crate) struct LoadedPlugin {
    pub manifest: PluginManifest,
    /// 插件是否来自用户导入目录（设置页据此展示「删除」）
    pub user_installed: bool,
    pub handle: FiberHandle,
    /// 保底引用：插件停止后由运行时 retired 列表继续持有，避免
    /// libloading Drop 触发 FreeLibrary（插件内部线程存活时卸载代码
    /// 不安全）。dll 文件随进程退出释放；目录删除用「改名隔离 +
    /// 启动清理」兜底。
    #[allow(dead_code)]
    pub(crate) lib: Arc<PluginLibrary>,
}

/// 内置插件目录：开发态取仓库根 `Plugins/`（编译期定位，发布态取资源目录）。
pub fn builtin_plugins_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        // src-tauri/CARGO_MANIFEST_DIR 的上一级即仓库根
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let root = manifest_dir
            .parent()
            .ok_or_else(|| "无法定位仓库根目录".to_string())?;
        Ok(root.join("Plugins"))
    } else {
        let resource_dir = app
            .path()
            .resource_dir()
            .map_err(|e| format!("无法解析资源目录: {e}"))?;
        Ok(resource_dir.join("Plugins"))
    }
}

/// 用户导入插件目录（应用数据目录 `plugins/`，始终可写；
/// `plugin_import_folder` / `plugin_import_mip` 把第三方插件复制到这里）
pub fn user_plugins_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = crate::scheme_store::data_dir(app)?.join("plugins");
    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|e| format!("无法创建用户插件目录 {}: {e}", dir.display()))?;
    }
    Ok(dir)
}

/// 插件扫描目录（按优先级排序，靠前的目录中同名 id 优先）：
/// 用户插件目录在前，内置目录在后。
/// 必须用「生效目录」（`effective_user_dir`，含设置中的自定义目录）——
/// 导入写到哪里，扫描就要查哪里；此前误用默认目录导致自定义目录下
/// 的插件永远不被加载。
pub fn plugin_dirs(app: &AppHandle) -> Result<Vec<PathBuf>, String> {
    Ok(vec![
        crate::plugin_manager::effective_user_dir(app)?,
        builtin_plugins_dir(app)?,
    ])
}

/// 校验插件 id：只允许字母/数字/-/_（同时用于命令前缀与 mbplugin:// 路径段）
pub(crate) fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// 扫描全部插件目录：按目录优先级去重（同名 id 保留优先目录中的那份）。
fn scan_unique(dirs: &[PathBuf], errors: &mut Vec<String>) -> HashMap<String, PathBuf> {
    let mut unique: HashMap<String, PathBuf> = HashMap::new();
    for dir in dirs {
        let entries = match fs::read_dir(dir) {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => {
                errors.push(format!("无法读取插件目录 {}: {e}", dir.display()));
                continue;
            }
        };
        for entry in entries.flatten() {
            let plugin_dir = entry.path();
            if !plugin_dir.is_dir() || !plugin_dir.join("plugin.json").exists() {
                continue;
            }
            let Some(name) = plugin_dir.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            // 跳过隐藏/隔离目录（删除操作留下的 .trash-* 隔离目录）
            if name.starts_with('.') {
                continue;
            }
            // 靠前目录优先：已存在时保留，不覆盖
            unique.entry(name.to_string()).or_insert(plugin_dir);
        }
    }
    unique
}

/// 扫描并加载全部插件目录。返回（成功清单，失败摘要）。
/// 同名 id 只加载一份：靠前的目录（用户导入）优先。
pub(crate) async fn load_all(
    root: &Context,
    dirs: &[PathBuf],
    user_dir: &Path,
) -> (Vec<LoadedPlugin>, Vec<String>) {
    let mut errors = Vec::new();
    let unique = scan_unique(dirs, &mut errors);
    let mut loaded = Vec::new();
    let mut names: Vec<_> = unique.keys().cloned().collect();
    names.sort();
    for name in names {
        let plugin_dir = &unique[&name];
        match load_one(root, plugin_dir, user_dir).await {
            Ok(item) => loaded.push(item),
            Err(e) => errors.push(format!("插件「{}」加载失败: {e}", plugin_dir.display())),
        }
    }
    (loaded, errors)
}

/// 热加载：扫描插件目录，跳过 already_loaded 中的 id，只加载新出现的插件。
/// （Windows 下运行中的 dll 无法覆盖，升级/替换同 id 插件仍需重启。）
pub(crate) async fn load_new(
    root: &Context,
    dirs: &[PathBuf],
    user_dir: &Path,
    already_loaded: &[String],
) -> (Vec<LoadedPlugin>, Vec<String>) {
    let mut errors = Vec::new();
    let unique = scan_unique(dirs, &mut errors);
    let mut loaded = Vec::new();
    let mut names: Vec<_> = unique.keys().cloned().collect();
    names.sort();
    for name in names {
        if already_loaded.iter().any(|id| id == &name) {
            continue;
        }
        let plugin_dir = &unique[&name];
        match load_one(root, plugin_dir, user_dir).await {
            Ok(item) => loaded.push(item),
            Err(e) => errors.push(format!("插件「{}」加载失败: {e}", plugin_dir.display())),
        }
    }
    (loaded, errors)
}

/// 加载单个插件目录
async fn load_one(
    root: &Context,
    plugin_dir: &Path,
    user_dir: &Path,
) -> Result<LoadedPlugin, String> {
    let dir_name = plugin_dir
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "插件目录名无效".to_string())?
        .to_string();
    let text = fs::read_to_string(plugin_dir.join("plugin.json"))
        .map_err(|e| format!("无法读取 plugin.json: {e}"))?;
    let manifest: PluginManifest =
        serde_json::from_str(&text).map_err(|e| format!("plugin.json 解析失败: {e}"))?;
    if !valid_id(&manifest.id) {
        return Err("插件 id 只允许字母/数字/-/_".to_string());
    }
    // 目录名与清单 id 必须一致：命令前缀与 mbplugin:// 路径都以 id 命名
    if manifest.id != dir_name {
        return Err(format!(
            "plugin.json 的 id「{}」与目录名「{dir_name}」不一致",
            manifest.id
        ));
    }
    if manifest.abi != MB_ABI_VERSION {
        return Err(format!(
            "ABI 版本不匹配（插件 {}，宿主 {MB_ABI_VERSION}）",
            manifest.abi
        ));
    }
    if manifest.entry.backend.is_empty() {
        return Err("清单缺少 entry.backend".to_string());
    }
    if !plugin_dir.join(&manifest.entry.backend).is_file() {
        return Err(format!(
            "后端库缺失: {}",
            manifest.entry.backend
        ));
    }

    let lib = Arc::new(PluginLibrary::new(&plugin_dir.join(&manifest.entry.backend))?);
    let abi = lib.abi_version()?;
    if abi != MB_ABI_VERSION {
        return Err(format!("dll ABI 版本不匹配（{abi}，宿主 {MB_ABI_VERSION}）"));
    }
    let commands = lib.declare(crate::runtime::vtable::vtable())?;

    let manifest_clone = manifest.clone();
    let user_installed = plugin_dir.starts_with(user_dir);
    // 保底引用留给 LoadedPlugin：运行中绝不 FreeLibrary（retired 持有）
    let lib_for_retire = Arc::clone(&lib);
    let plugin = DiskPlugin {
        manifest,
        commands,
        lib,
    };
    let plugin_id = manifest_clone.id.clone();
    let handle = root
        .spawn(PreparedPlugin::from_input(plugin, ()))
        .await
        .map_err(|e| format!("插件「{plugin_id}」启动失败: {e}"))?;
    Ok(LoadedPlugin {
        manifest: manifest_clone,
        user_installed,
        handle,
        lib: lib_for_retire,
    })
}
