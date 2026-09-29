//! mb-bundler CLI：`mb-bundler <entry> <id> <out>`
//! 供 scripts/build-plugins.mjs（CI/开发构建）调用；应用内导入源码插件
//! 时由 src-tauri 直接进程内调用 lib，不走本 CLI。
//! 本地相对导入内联进 bundle；react/@lib/* 等共享依赖一律生成为
//! require()，运行时经宿主 hostRequire 提供（与 esbuild 版 external 行为
//! 一致，无需传依赖列表）。

use std::process::ExitCode;

use mb_bundler::BundleOptions;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [entry, id, out] = args.as_slice() else {
        eprintln!("用法: mb-bundler <entry> <id> <out>");
        return ExitCode::from(2);
    };

    match mb_bundler::bundle(BundleOptions {
        entry: std::path::Path::new(entry),
        id,
        out: std::path::Path::new(out),
    }) {
        Ok(()) => {
            println!("[mb-bundler] {out} 已生成");
            ExitCode::SUCCESS
        }
        Err(err) => {
            eprintln!("[mb-bundler] 打包失败：{err}");
            ExitCode::FAILURE
        }
    }
}
