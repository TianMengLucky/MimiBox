// 把平台 esbuild 可执行文件复制为打包资源（应用内导入源码插件时现场打包前端用）。
// pnpm build 末尾自动执行；产物 src-tauri/resources/esbuild.exe 已 gitignore。
// 平台包是 esbuild 的传递依赖（pnpm 不提升到根），所以从 esbuild 包自己的
// 依赖上下文解析二进制路径。

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const projectRequire = createRequire(import.meta.url);
const esbuildRequire = createRequire(projectRequire.resolve("esbuild/package.json"));
const exe = esbuildRequire.resolve("@esbuild/win32-x64/esbuild.exe");
const dest = path.resolve(import.meta.dirname, "..", "src-tauri", "resources", "esbuild.exe");
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(exe, dest);
console.log(`[copy-esbuild] esbuild.exe → ${dest}`);
