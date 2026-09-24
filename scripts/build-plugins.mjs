#!/usr/bin/env node
// 插件构建编排：逐插件编译 Rust cdylib + esbuild 打包前端 → 产物拷进 Plugins/<id>/。
//
// 产物布局（运行时由宿主加载）：
//   Plugins/<id>/backend.dll          ← target/release/<crate>.dll
//   Plugins/<id>/frontend/index.js    ← esbuild CJS 工厂（react 等依赖外置经宿主 require）
//
// 开发：`pnpm build:plugins` 手动构建，或 `pnpm plugins:watch` 增量监听前端改动
// （Rust dll 改动需重启应用，Windows 下已加载的 dll 无法覆盖）。

import { build } from "esbuild";
import { zipSync } from "fflate";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { PLUGINS, esbuildFrontendOptions } from "./plugin-config.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const pluginsRoot = path.join(repoRoot, "Plugins");

function buildBackend(plugin) {
  execSync(`cargo build --release -p ${plugin.crate}`, {
    cwd: repoRoot,
    stdio: "inherit",
  });
  // crate 名 mimibox-plugin-<id> → dll 名 mimibox_plugin_<id>.dll
  const dllName = `${plugin.crate.replaceAll("-", "_")}.dll`;
  const dist = path.join(repoRoot, "target", "release", dllName);
  if (!fs.existsSync(dist)) {
    throw new Error(`后端 dll 未生成: ${dist}`);
  }
  fs.copyFileSync(dist, path.join(pluginsRoot, plugin.id, "backend.dll"));
  console.log(`[plugin:${plugin.id}] backend.dll 已更新`);
}

async function buildFrontend(plugin) {
  const options = esbuildFrontendOptions(plugin.id);
  await build({ ...options, logLevel: "info" });
  console.log(`[plugin:${plugin.id}] frontend/index.js 已更新`);
}

/**
 * 把构建产物打包为 .mip 分发包（zip，由 Node 内 fflate 直接生成）。
 * 包内只含清单与运行时产物：plugin.json、entry.backend（backend.dll）、
 * frontend/index.js；不含 Rust/TS 源码。
 * 不用系统 tar：Windows CI 上 GNU tar 不支持 --format zip、bsdtar 的 -a
 * 又会按扩展名静默回退为 tar 格式，跨平台行为不一致。
 */
function packMip(plugin) {
  const dir = path.join(pluginsRoot, plugin.id);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "plugin.json"), "utf8"));
  // 打包前校验运行时产物齐全（--mip-only 跳过编译时尤其重要）
  const missing = ["plugin.json", manifest.entry.backend, ...(manifest.entry.frontend ? [manifest.entry.frontend] : [])]
    .filter((f) => !fs.existsSync(path.join(dir, f)));
  if (missing.length > 0) {
    throw new Error(
      `[plugin:${plugin.id}] 缺少构建产物 ${missing.join("、")}——请先运行 pnpm build:plugins`,
    );
  }
  const files = {
    "plugin.json": fs.readFileSync(path.join(dir, "plugin.json")),
    [manifest.entry.backend]: fs.readFileSync(path.join(dir, manifest.entry.backend)),
  };
  if (manifest.entry.frontend && fs.existsSync(path.join(dir, manifest.entry.frontend))) {
    files[manifest.entry.frontend] = fs.readFileSync(path.join(dir, manifest.entry.frontend));
  }
  const out = path.join(pluginsRoot, `${plugin.id}.mip`);
  fs.rmSync(out, { force: true });
  fs.writeFileSync(out, zipSync(files));
  console.log(`[plugin:${plugin.id}] ${plugin.id}.mip 已生成`);
}

const args = process.argv.slice(2);
const mipOnly = args.includes("--mip-only"); // 跳过编译，仅打包现有构建产物
const only = args.find((arg) => !arg.startsWith("--")); // 可选：只构建某个插件
const targets = PLUGINS.filter((plugin) => !only || plugin.id === only);
if (targets.length === 0) {
  console.error(`没有匹配的插件: ${only}（可选: ${PLUGINS.map((p) => p.id).join(", ")}）`);
  process.exit(1);
}

if (mipOnly) {
  for (const plugin of targets) {
    packMip(plugin);
  }
  console.log("\n全部 .mip 分发包打包完成");
  process.exit(0);
}

for (const plugin of targets) {
  console.log(`\n===== 构建插件 ${plugin.id} =====`);
  buildBackend(plugin);
  if (plugin.frontend) {
    await buildFrontend(plugin);
  }
  packMip(plugin);
}
console.log("\n全部插件构建完成");
