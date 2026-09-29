#!/usr/bin/env node
// 插件前端增量监听：前端改动经 mb-bundler（Oxc）自动重打包，应用内刷新即生效。
// 后端 dll 不支持热替换（Windows 锁定已加载 dll），Rust 改动需重启应用并重跑 pnpm build:plugins。

import fs from "node:fs";
import path from "node:path";

import { bundleFrontend, PLUGINS } from "./plugin-config.mjs";

const pluginsRoot = path.resolve(import.meta.dirname, "..", "Plugins");

for (const plugin of PLUGINS) {
  if (!plugin.frontend) continue;
  const frontendDir = path.join(pluginsRoot, plugin.id, "frontend");
  let timer;
  fs.watch(frontendDir, { recursive: true }, () => {
    // 防抖：一次保存常触发多个事件
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        bundleFrontend(plugin);
      } catch {
        // 打包失败信息已由子进程输出，等待下一次改动重试
      }
    }, 150);
  });
  console.log(`[plugin:${plugin.id}] 前端监听中…`);
}
process.on("SIGINT", () => process.exit(0));
