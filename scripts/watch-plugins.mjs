#!/usr/bin/env node
// 插件前端增量监听：前端改动经 esbuild watch 自动重打包，应用内刷新即生效。
// 后端 dll 不支持热替换（Windows 锁定已加载 dll），Rust 改动需重启应用并重跑 pnpm build:plugins。

import process from "node:process";
import { context } from "esbuild";

import { PLUGINS, esbuildFrontendOptions } from "./plugin-config.mjs";

for (const plugin of PLUGINS) {
  if (!plugin.frontend) continue;
  const pluginContext = await context({
    ...esbuildFrontendOptions(plugin.id),
    logLevel: "info",
  });
  await pluginContext.watch();
  console.log(`[plugin:${plugin.id}] 前端监听中…`);
}
process.on("SIGINT", () => process.exit(0));
