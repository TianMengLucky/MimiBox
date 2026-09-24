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

const only = process.argv[2]; // 可选：只构建某个插件（pnpm build:plugins lottery）
const targets = PLUGINS.filter((plugin) => !only || plugin.id === only);
if (targets.length === 0) {
  console.error(`没有匹配的插件: ${only}（可选: ${PLUGINS.map((p) => p.id).join(", ")}）`);
  process.exit(1);
}

for (const plugin of targets) {
  console.log(`\n===== 构建插件 ${plugin.id} =====`);
  buildBackend(plugin);
  if (plugin.frontend) {
    await buildFrontend(plugin);
  }
}
console.log("\n全部插件构建完成");
