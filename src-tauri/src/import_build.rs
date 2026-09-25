//! 插件源码现场编译：导入含源码的插件包时，在用户机器上构建运行时产物。
//!
//! 触发条件（产物缺失才编译，含预构建产物的包直接跳过）：
//! - `backend/Cargo.toml` 存在且缺少 `entry.backend`（如 backend.dll）
//!   → `cargo build --release`，需要用户机器装有 Rust 工具链（cargo + MSVC）
//! - `frontend/index.tsx|.ts` 存在且缺少 `entry.frontend`（如 frontend/index.js）
//!   → 内置 esbuild（随应用分发的独立二进制）打包，参数与 CI 构建一致
//!
//! 源码包要求 backend 是自包含 cargo 工程（依赖走 crates.io 或包内 vendored
//! path），前端入口约定为 `frontend/index.tsx`。插件是信任代码，不做沙箱。

use std::path::Path;
use std::process::Command;

use serde_json::json;
use tauri::{AppHandle, Manager};

use crate::loader::PluginManifest;

/// Windows 下启动子进程不弹出控制台窗口
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn spawn_command(mut command: Command) -> Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// 前端打包的外置依赖：与 scripts/plugin-config.mjs 的 EXTERNAL 保持一致
/// （运行时经宿主共享模块表 hostRequire 提供）
const EXTERNALS: &[&str] = &[
    "react",
    "react-dom",
    "react-dom/client",
    "react/jsx-runtime",
    "@heroui/react",
    "@iconify/react",
    "@apvee/react-layout-kit",
    "motion/react",
    "@tanstack/react-router",
    "@tauri-apps/*",
    "@lib/*",
    "@components/*",
    "mb-host",
];

fn emit_progress(app: &AppHandle, text: &str) {
    use tauri::Emitter;
    let _ = app.emit("import-progress", text);
}

/// 截取编译错误输出的末尾若干行（完整输出可能很长）
fn tail_lines(text: &str, max: usize) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let start = lines.len().saturating_sub(max);
    lines[start..].join("\n")
}

/// 导入收尾：按需现场编译缺失的运行时产物，最后校验后端库存在。
/// `build_dir` 为 cargo 构建缓存目录（须在插件目录之外，避免随插件落位）。
pub(crate) fn ensure_built(
    app: &AppHandle,
    dir: &Path,
    manifest: &PluginManifest,
    build_dir: &Path,
) -> Result<(), String> {
    // 后端源码 → cargo 编译（产物缺失时）
    let backend_src = dir.join("backend");
    if backend_src.join("Cargo.toml").is_file()
        && !dir.join(&manifest.entry.backend).is_file()
    {
        build_backend_crate(app, &backend_src, build_dir, dir, &manifest.entry.backend)?;
    }
    if !dir.join(&manifest.entry.backend).is_file() {
        return Err(format!("后端库缺失: {}", manifest.entry.backend));
    }

    // 前端源码 → 内置 esbuild 打包（产物缺失时）
    if !manifest.entry.frontend.is_empty()
        && !dir.join(&manifest.entry.frontend).is_file()
    {
        let frontend_dir = dir.join("frontend");
        let entry_src = ["index.tsx", "index.ts"]
            .iter()
            .map(|name| frontend_dir.join(name))
            .find(|path| path.is_file());
        let Some(entry_src) = entry_src else {
            return Err(format!(
                "前端产物缺失且未找到源码入口（{} 或 {}）",
                frontend_dir.join("index.tsx").display(),
                frontend_dir.join("index.ts").display(),
            ));
        };
        build_frontend_bundle(app, &entry_src, &dir.join(&manifest.entry.frontend), &manifest.id)?;
    }
    Ok(())
}

/// 编译后端 Rust 源码：`cargo build --release`（需用户机器装有 Rust 工具链）。
/// `build_dir` 作为 --target-dir（在插件目录之外）。
fn build_backend_crate(
    app: &AppHandle,
    backend_src: &Path,
    build_dir: &Path,
    out_dir: &Path,
    entry: &str,
) -> Result<(), String> {
    match spawn_command(Command::new("cargo")).arg("--version").output() {
        Err(_) => {
            return Err(
                "该插件包是源码分发包，需要 Rust 工具链编译后端：请安装 Rust \
                （https://rustup.rs，含 MSVC 生成工具）后重试，或改用含预构建 \
                 backend.dll 的插件包"
                    .to_string(),
            );
        }
        Ok(output) if !output.status.success() => {
            return Err("Rust 工具链不可用：cargo --version 执行失败".to_string());
        }
        Ok(_) => {}
    }

    emit_progress(app, "正在编译插件后端（首次构建可能需要几分钟）…");
    let target_dir = build_dir.join("release-target");
    let output = spawn_command(Command::new("cargo"))
        .args(["build", "--release", "--target-dir"])
        .arg(&target_dir)
        .current_dir(backend_src)
        .output()
        .map_err(|e| format!("无法启动 cargo: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "插件后端编译失败：\n{}",
            tail_lines(&String::from_utf8_lossy(&output.stderr), 40)
        ));
    }

    // 定位 cdylib 产物：target/release/*.dll（单 dll 约定）
    let release = target_dir.join("release");
    let mut dlls: Vec<std::path::PathBuf> = fs_read_dir_dlls(&release)?;
    match dlls.len() {
        1 => {
            let dll = dlls.remove(0);
            std::fs::copy(&dll, out_dir.join(entry))
                .map_err(|e| format!("无法复制编译产物 {}: {e}", dll.display()))?;
        }
        0 => {
            return Err(
                "编译产物中未找到 .dll：请确认 backend 的 crate-type 包含 cdylib".to_string(),
            );
        }
        _ => {
            return Err("编译产物中存在多个 .dll，无法确定插件动态库".to_string());
        }
    }
    Ok(())
}

fn fs_read_dir_dlls(dir: &Path) -> Result<Vec<std::path::PathBuf>, String> {
    let entries = std::fs::read_dir(dir).map_err(|e| format!("无法读取编译产物目录: {e}"))?;
    Ok(entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|e| e.to_str()) == Some("dll"))
        .collect())
}

/// 用内置 esbuild 打包前端源码（参数与 CI 构建一致：CJS 工厂注册到
/// window.__mb_plugins，外置依赖经宿主共享模块表提供）
fn build_frontend_bundle(
    app: &AppHandle,
    entry_src: &Path,
    out_file: &Path,
    id: &str,
) -> Result<(), String> {
    let esbuild = app
        .path()
        .resource_dir()
        .map_err(|e| format!("无法解析资源目录: {e}"))?
        .join("resources")
        .join(if cfg!(windows) { "esbuild.exe" } else { "esbuild" });
    if !esbuild.is_file() {
        return Err(format!(
            "应用缺少内置的 esbuild（{}），无法编译前端源码",
            esbuild.display()
        ));
    }

    emit_progress(app, "正在打包插件前端…");
    // 与 scripts/plugin-config.mjs 的 banner/footer 一致：CJS 工厂注册
    let banner = format!(
        "window.__mb_plugins=window.__mb_plugins||{{}};window.__mb_plugins[{}]=function(require,module,exports){{",
        json!(id)
    );

    let mut command = spawn_command(Command::new(&esbuild));
    command
        .arg(entry_src)
        .arg("--bundle")
        .arg("--format=cjs")
        .arg("--jsx=automatic")
        .arg("--target=es2022")
        .arg("--loader:.css=empty")
        .arg("--define:import.meta.env.DEV=false");
    for external in EXTERNALS {
        command.arg(format!("--external:{external}"));
    }
    command
        .arg(format!("--banner:js={banner}"))
        .arg("--footer:js=}")
        .arg(format!("--outfile={}", out_file.display()));

    let output = command
        .output()
        .map_err(|e| format!("无法启动 esbuild: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "插件前端打包失败：\n{}",
            tail_lines(&String::from_utf8_lossy(&output.stderr), 40)
        ));
    }
    Ok(())
}
