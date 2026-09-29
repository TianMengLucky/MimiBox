//! 插件导入统一文件接口：文件夹 / 完整 .mip 包 / 后端动态库 / 前端
//! bundle zip，全部经 [`plugin_import_file`]（路径）与
//! [`plugin_import_dropped`]（拖入/点击选择的文件字节）导入，按导入类型
//! 自动分发：
//!
//! - 目录 → 完整插件文件夹导入（含源码现场编译）
//! - zip（PK 魔数）→ 含 plugin.json 的是完整 .mip 包；否则按前端
//!   bundle zip 处理
//! - 动态库（PE / ELF / Mach-O 魔数）→ 后端动态库导入
//!
//! 与完整 .mip 导入互补——后端 dll 与前端 zip 不需要 plugin.json 清单，
//! 插件信息经产物自身的「接口」读取：
//!
//! - 动态库：SDK `export_plugin!` 宏生成的 `mb_plugin_manifest` 导出函数
//!   返回清单 JSON；未提供该接口时回退为文件名派生（id = 文件名，标题 = id）。
//! - 前端 zip：bundle `defineMbPlugin` 定义中的 `meta` 自述字段，由 WebView
//!   端执行 bundle 工厂读取（与插件运行时同一 JS 环境，不引入额外运行时），
//!   随导入请求头传给宿主；未声明时回退为 CJS 工厂 banner 注册的 id。
//!
//! 同 id 已存在用户插件（例如先前导入的另一侧产物）时合并：保留另一侧
//! 的入口与文件，补齐为完整插件。产物是信任代码，不做沙箱。

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Deserialize;
use tauri::AppHandle;

use crate::loader::{valid_id, PluginEntry, PluginManifest};
use crate::plugin_manager::{
    copy_dir_contents, effective_user_dir, import_folder_impl, import_mip_impl, is_excluded_entry,
    parse_manifest, safe_entry_name, verify_backend, ImportOutcome,
};
use mimibox_plugin::MB_ABI_VERSION;

/// 插件导入统一接口：传入文件或目录路径，按类型自动分发：
/// 目录 → 文件夹导入；zip → 完整 .mip 包 / 前端 bundle zip；
/// 动态库 → 后端 dll 导入。导入后由前端调用 plugin_reload 热加载。
/// 前端 bundle 的 meta 自述无法经路径获取，为 None（回退 id 派生）——
/// 需要自述信息时走 [`plugin_import_dropped`] 字节接口。
#[tauri::command]
pub async fn plugin_import_file(app: AppHandle, path: String) -> Result<ImportOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || import_file_impl(app, path, None))
        .await
        .map_err(|e| format!("导入任务执行失败: {e}"))?
}

fn import_file_impl(
    app: AppHandle,
    path: String,
    meta: Option<FrontendMeta>,
) -> Result<ImportOutcome, String> {
    let source = PathBuf::from(&path);
    // 目录 → 完整插件文件夹
    if source.is_dir() {
        return import_folder_impl(app, path);
    }
    if !source.is_file() {
        return Err("文件不存在，请重新选择".to_string());
    }

    // 魔数嗅探识别文件类型
    let mut magic = [0u8; 4];
    let read_len = fs::File::open(&source)
        .and_then(|mut f| f.read(&mut magic))
        .map_err(|e| format!("无法读取文件: {e}"))?;
    let is_zip = read_len >= 2 && &magic[..2] == b"PK";
    let is_lib = read_len >= 4
        && (&magic[..2] == b"MZ"                            // Windows PE (.dll)
            || &magic[..4] == [0x7F, b'E', b'L', b'F']      // Linux (.so)
            || &magic[..4] == [0xFE, 0xED, 0xFA, 0xCE]      // Mach-O 32 大端
            || &magic[..4] == [0xFE, 0xED, 0xFA, 0xCF]      // Mach-O 64 大端
            || &magic[..4] == [0xCE, 0xFA, 0xED, 0xFE]      // Mach-O 32 小端
            || &magic[..4] == [0xCF, 0xFA, 0xED, 0xFE]      // Mach-O 64 小端
            || &magic[..4] == [0xCA, 0xFE, 0xBA, 0xBE]);    // Mach-O fat

    if is_zip {
        return if zip_has_manifest(&source) {
            import_mip_impl(app, path)
        } else {
            import_frontend_zip_impl(app, path, meta)
        };
    }
    if is_lib {
        return import_dll_impl(app, path);
    }

    // 魔数无法识别时按扩展名兜底（如旧的非 zip .mip 资产，给出明确错误）
    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "mip" | "zip" => {
            if ext == "mip" {
                import_mip_impl(app, path)
            } else {
                import_frontend_zip_impl(app, path, meta)
            }
        }
        "dll" | "so" | "dylib" => import_dll_impl(app, path),
        _ => Err(
            "无法识别的插件文件类型（支持插件文件夹、.mip 插件包、后端动态库、前端 zip 包）"
                .to_string(),
        ),
    }
}

/// 判断 zip 包内是否带 plugin.json 完整清单（区分完整 .mip 包与前端 bundle zip）
fn zip_has_manifest(path: &Path) -> bool {
    let Ok(file) = fs::File::open(path) else {
        return false;
    };
    let Ok(mut zip) = zip::ZipArchive::new(file) else {
        return false;
    };
    // 先落到局部变量：`zip.by_name(...).is_ok()` 直接作为尾表达式会因临时
    // ZipFile 的析构晚于 zip 而无法通过借用检查
    let has = zip.by_name("plugin.json").is_ok();
    has
}

// ---------------------------------------------------------------------------
// 拖入文件导入
// ---------------------------------------------------------------------------

/// 拖入/点击选择的文件导入：WebView 的拖放事件拿不到绝对路径（HTML5
/// File 对象不含路径），前端把文件字节经 raw IPC 上传，这里暂存为临时
/// 文件后走 [`import_file_impl`] 统一导入流程（按魔数识别类型），完成后
/// 清理临时文件。文件名经 `x-mb-file-name` 头传递，前端 bundle 的 meta
/// 自述经 `x-mb-plugin-meta` 头传递（均 percent 编码，避免非 ASCII 头非法）。
#[tauri::command]
pub async fn plugin_import_dropped(
    app: AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<ImportOutcome, String> {
    use percent_encoding::percent_decode_str;

    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(|value| percent_decode_str(value).decode_utf8_lossy().into_owned())
    };
    let name = header("x-mb-file-name").unwrap_or_else(|| "plugin.bin".to_string());
    // meta 自述：前端 zip 导入时由 WebView 执行 bundle 工厂读取（JSON）
    let meta = match header("x-mb-plugin-meta") {
        Some(json) => Some(
            serde_json::from_str(&json).map_err(|e| format!("meta 自述解析失败: {e}"))?,
        ),
        None => None,
    };
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        tauri::ipc::InvokeBody::Json(_) => {
            return Err("不支持的请求体：拖入文件须以二进制上传".to_string())
        }
    };
    tauri::async_runtime::spawn_blocking(move || import_dropped_impl(app, name, bytes, meta))
        .await
        .map_err(|e| format!("导入任务执行失败: {e}"))?
}

fn import_dropped_impl(
    app: AppHandle,
    name: String,
    bytes: Vec<u8>,
    meta: Option<FrontendMeta>,
) -> Result<ImportOutcome, String> {
    if bytes.is_empty() {
        return Err("拖入的文件为空".to_string());
    }
    // 文件名只保留安全字符（字母/数字/.-_），其余替换为 _，防路径穿越
    let safe: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let dir = std::env::temp_dir().join(format!("mimibox-import-{}", std::process::id()));
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建暂存目录: {e}"))?;
    let temp = dir.join(&safe);
    if let Err(e) = fs::write(&temp, &bytes) {
        let _ = fs::remove_dir_all(&dir);
        return Err(format!("无法暂存拖入文件: {e}"));
    }
    let result = import_file_impl(app, temp.display().to_string(), meta);
    let _ = fs::remove_file(&temp);
    let _ = fs::remove_dir(&dir);
    result
}

// ---------------------------------------------------------------------------
// 动态库导入
// ---------------------------------------------------------------------------

fn import_dll_impl(app: AppHandle, path: String) -> Result<ImportOutcome, String> {
    let source = PathBuf::from(&path);
    if !source.is_file() {
        return Err("插件动态库不存在，请重新选择".to_string());
    }
    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(ext.as_str(), "dll" | "so" | "dylib") {
        return Err("请选择插件后端动态库文件（.dll）".to_string());
    }

    // 探测：加载 → 校验 ABI → 调用 mb_plugin_manifest 接口读取内嵌清单。
    // 探测后故意不卸载（插件 dll 可能含常驻线程，泄漏即安全）。
    let lib = Arc::new(crate::runtime::adapter::PluginLibrary::new(&source)?);
    let abi = lib.abi_version()?;
    if abi != MB_ABI_VERSION {
        return Err(format!(
            "ABI 版本不匹配（插件 {abi}，宿主 {MB_ABI_VERSION}），请联系插件作者适配当前应用版本"
        ));
    }
    let embedded = lib.manifest_json();
    std::mem::forget(lib);

    let stem = source
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_string();
    let mut manifest = match &embedded {
        Some(json) => manifest_from_json(json)?,
        None => {
            let id = sanitize_id(&stem)?;
            fallback_manifest(&id)
        }
    };
    // 单产物：入口归一化为 backend.dll；前端入口留空（可由前端 zip 合并补齐）
    manifest.entry.backend = backend_lib_name().to_string();
    manifest.entry.frontend.clear();

    let user_dir = effective_user_dir(&app)?;
    let target = merge_target(&user_dir, &mut manifest, embedded.is_some())?;
    fs::copy(&source, target.join(backend_lib_name())).map_err(|e| {
        format!("无法写入插件动态库（可能正在使用中，请重启应用后重试）: {e}")
    })?;
    write_manifest(&target, &manifest)?;
    parse_manifest(&target)?;
    verify_backend(&target, &manifest)?;
    Ok(ImportOutcome {
        manifest,
        installed_path: target.display().to_string(),
    })
}

// ---------------------------------------------------------------------------
// 前端 zip 导入
// ---------------------------------------------------------------------------

fn import_frontend_zip_impl(
    app: AppHandle,
    path: String,
    meta: Option<FrontendMeta>,
) -> Result<ImportOutcome, String> {
    let file = fs::File::open(&path).map_err(|e| format!("无法打开压缩包: {e}"))?;
    let mut zip =
        zip::ZipArchive::new(file).map_err(|_| "不是有效的 zip 压缩包".to_string())?;
    if zip.by_name("plugin.json").is_ok() {
        return Err("该压缩包含 plugin.json 完整清单，请使用「.mip 插件包」导入".to_string());
    }

    // 收集 .js 候选（跳过构建缓存/系统垃圾）
    let mut candidates: Vec<(String, String)> = Vec::new();
    for index in 0..zip.len() {
        let mut entry = zip
            .by_index(index)
            .map_err(|e| format!("无法读取压缩包内容: {e}"))?;
        let Some(name) = safe_entry_name(entry.name()) else {
            continue;
        };
        if entry.is_dir() {
            continue;
        }
        if is_excluded_entry(&name) || !name.to_ascii_lowercase().ends_with(".js") {
            continue;
        }
        let mut buffer = Vec::new();
        entry
            .read_to_end(&mut buffer)
            .map_err(|e| format!("读取压缩包内 {name} 失败: {e}"))?;
        candidates.push((name, String::from_utf8_lossy(&buffer).into_owned()));
    }

    // 选定入口 bundle：index.js 优先，其次唯一候选
    let entry_name = match candidates.iter().position(|(name, _)| {
        name == "index.js" || name.ends_with("/index.js")
    }) {
        Some(index) => candidates[index].0.clone(),
        None if candidates.len() == 1 => candidates[0].0.clone(),
        None if candidates.is_empty() => {
            return Err("压缩包中未找到前端 bundle（.js 文件）".to_string());
        }
        None => {
            let names = candidates
                .iter()
                .map(|(name, _)| name.as_str())
                .collect::<Vec<_>>()
                .join("、");
            return Err(format!("压缩包中存在多个 js 文件，无法确定前端入口：{names}"));
        }
    };
    let bundle = candidates
        .iter()
        .find(|(name, _)| *name == entry_name)
        .map(|(_, text)| text.clone())
        .unwrap_or_default();

    // 前端必须经 window.__mb_plugins 注册工厂（运行时按 manifest.id 查找）
    let id = extract_banner_id(&bundle)
        .ok_or_else(|| "bundle 未通过 window.__mb_plugins 注册插件工厂，无法确定插件 id".to_string())?;
    if !valid_id(&id) {
        return Err(format!("bundle 注册的插件 id 非法: {id}"));
    }

    // meta 自述由 WebView 端执行 bundle 工厂读取后随请求头传入；
    // 未提供（或 bundle 未声明）时回退为 id 派生清单
    let mut manifest = fallback_manifest(&id);
    let mut from_interface = false;
    if let Some(meta) = &meta {
        from_interface = true;
        if let Some(title) = &meta.title {
            manifest.title = title.clone();
        }
        if let Some(emoji) = &meta.emoji {
            manifest.emoji = emoji.clone();
        }
        if let Some(description) = &meta.description {
            manifest.description = description.clone();
        }
        if let Some(category) = &meta.category {
            manifest.category = category.clone();
        }
        if let Some(version) = &meta.version {
            manifest.version = version.clone();
        }
    }
    // 单产物：入口为 bundle 在包内的实际路径；后端入口留空（可由 dll 合并补齐）
    manifest.entry.frontend = entry_name;
    manifest.entry.backend.clear();

    // 先解压到暂存目录：校验通过后才落位
    let user_dir = effective_user_dir(&app)?;
    let staging = user_dir.join(format!(".import-staging-{}", std::process::id()));
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(|e| format!("无法清理暂存目录: {e}"))?;
    }
    fs::create_dir_all(&staging).map_err(|e| format!("无法创建暂存目录: {e}"))?;

    let extract_result = (|| -> Result<(), String> {
        for index in 0..zip.len() {
            let mut entry = zip
                .by_index(index)
                .map_err(|e| format!("无法读取压缩包内容: {e}"))?;
            let Some(name) = safe_entry_name(entry.name()) else {
                continue;
            };
            if name == "plugin.json" {
                continue;
            }
            if is_excluded_entry(&name) {
                continue;
            }
            let dest = staging.join(&name);
            if entry.is_dir() {
                fs::create_dir_all(&dest).map_err(|e| format!("无法创建 {dest:?}: {e}"))?;
                continue;
            }
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("无法创建 {parent:?}: {e}"))?;
            }
            let mut buffer = Vec::new();
            entry
                .read_to_end(&mut buffer)
                .map_err(|e| format!("读取压缩包内 {name} 失败: {e}"))?;
            fs::write(&dest, buffer).map_err(|e| format!("写入 {dest:?} 失败: {e}"))?;
        }
        Ok(())
    })();
    if let Err(e) = extract_result {
        let _ = fs::remove_dir_all(&staging);
        return Err(e);
    }

    let target = match merge_target(&user_dir, &mut manifest, from_interface) {
        Ok(target) => target,
        Err(e) => {
            let _ = fs::remove_dir_all(&staging);
            return Err(e);
        }
    };
    if let Err(e) = copy_dir_contents(&staging, &target) {
        let _ = fs::remove_dir_all(&staging);
        return Err(e);
    }
    let _ = fs::remove_dir_all(&staging);
    write_manifest(&target, &manifest)?;
    parse_manifest(&target)?;
    Ok(ImportOutcome {
        manifest,
        installed_path: target.display().to_string(),
    })
}

// ---------------------------------------------------------------------------
// 共用辅助
// ---------------------------------------------------------------------------

/// bundle 的 CJS 工厂注册语句提取 id：`window.__mb_plugins["<id>"]=function`
fn extract_banner_id(bundle: &str) -> Option<String> {
    let key = "window.__mb_plugins[";
    let start = bundle.find(key)? + key.len();
    let rest = bundle[start..].strip_prefix('"')?;
    let end = rest.find('"')?;
    let id = &rest[..end];
    (!id.is_empty()).then(|| id.to_string())
}

/// bundle defineMbPlugin 定义中的 meta 自述字段：由 WebView 端执行 bundle
/// 工厂读取后，随导入请求头（percent 编码的 JSON）传给宿主
#[derive(Deserialize)]
struct FrontendMeta {
    title: Option<String>,
    emoji: Option<String>,
    description: Option<String>,
    category: Option<String>,
    version: Option<String>,
}

/// 解析接口返回的清单 JSON 并校验 id/ABI
fn manifest_from_json(json: &str) -> Result<PluginManifest, String> {
    let manifest: PluginManifest =
        serde_json::from_str(json).map_err(|e| format!("插件内嵌清单解析失败: {e}"))?;
    if !valid_id(&manifest.id) {
        return Err(format!("内嵌清单的插件 id 非法: {}", manifest.id));
    }
    if manifest.abi != MB_ABI_VERSION {
        return Err(format!(
            "内嵌清单 ABI 版本不匹配（插件 {}，宿主 {MB_ABI_VERSION}）",
            manifest.abi
        ));
    }
    Ok(manifest)
}

/// 从任意文件名派生合法插件 id：非法字符替换为 -，去除首尾 -
fn sanitize_id(raw: &str) -> Result<String, String> {
    let mut id: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    while id.starts_with('-') {
        id.remove(0);
    }
    while id.ends_with('-') {
        id.pop();
    }
    if id.is_empty() {
        return Err("无法从文件名派生有效的插件 id，请让插件产物提供清单接口".to_string());
    }
    Ok(id)
}

/// 回退清单：仅有 id 与展示占位（标题 = id，归入 fun 分类）
fn fallback_manifest(id: &str) -> PluginManifest {
    PluginManifest {
        id: id.to_string(),
        title: id.to_string(),
        emoji: String::new(),
        description: String::new(),
        category: "fun".to_string(),
        abi: MB_ABI_VERSION,
        version: String::new(),
        requires: Vec::new(),
        entry: PluginEntry::default(),
    }
}

/// 后端动态库的归一化文件名
fn backend_lib_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "backend.dylib"
    } else if cfg!(target_os = "windows") {
        "backend.dll"
    } else {
        "backend.so"
    }
}

/// 目标目录处理：`<id>` 不存在 → 新建；存在且有清单 → 解析既有清单并合并
/// （保留另一侧入口，文件不清理，另一侧产物继续生效）；存在但无清单 →
/// 视为残留垃圾，清理重建。`from_interface` 表示本次产物携带了接口自述
/// 信息（此时展示信息以本次为准，即升级语义）；回退派生时保留既有信息。
fn merge_target(
    user_dir: &Path,
    manifest: &mut PluginManifest,
    from_interface: bool,
) -> Result<PathBuf, String> {
    let target = user_dir.join(&manifest.id);
    let manifest_path = target.join("plugin.json");
    let existing: Option<PluginManifest> = if target.is_dir() {
        if manifest_path.is_file() {
            let text = fs::read_to_string(&manifest_path)
                .map_err(|e| format!("既有 plugin.json 无法读取: {e}"))?;
            Some(
                serde_json::from_str(&text)
                    .map_err(|e| format!("既有 plugin.json 解析失败: {e}"))?,
            )
        } else {
            fs::remove_dir_all(&target)
                .map_err(|e| format!("无法清理不完整的插件目录 {target:?}: {e}"))?;
            None
        }
    } else {
        None
    };

    if let Some(existing) = existing {
        // 另一侧入口保留（目录未清理，产物文件继续生效）
        if manifest.entry.backend.is_empty() {
            manifest.entry.backend = existing.entry.backend.clone();
        }
        if manifest.entry.frontend.is_empty() {
            manifest.entry.frontend = existing.entry.frontend.clone();
        }
        if !from_interface {
            if manifest.title == manifest.id && !existing.title.is_empty() {
                manifest.title = existing.title;
            }
            if manifest.emoji.is_empty() {
                manifest.emoji = existing.emoji.clone();
            }
            if manifest.description.is_empty() {
                manifest.description = existing.description.clone();
            }
            if manifest.version.is_empty() {
                manifest.version = existing.version.clone();
            }
            if manifest.requires.is_empty() {
                manifest.requires = existing.requires.clone();
            }
            if (manifest.category.is_empty() || manifest.category == "fun")
                && !existing.category.is_empty()
            {
                manifest.category = existing.category.clone();
            }
        }
    }

    fs::create_dir_all(&target)
        .map_err(|e| format!("无法创建插件目录 {}: {e}", target.display()))?;
    Ok(target)
}

/// 写入生成的 plugin.json
fn write_manifest(target: &Path, manifest: &PluginManifest) -> Result<(), String> {
    let text =
        serde_json::to_string_pretty(manifest).map_err(|e| format!("清单序列化失败: {e}"))?;
    fs::write(target.join("plugin.json"), text)
        .map_err(|e| format!("无法写入 plugin.json: {e}"))
}
