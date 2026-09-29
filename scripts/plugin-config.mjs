// 插件构建共享配置：build-plugins.mjs 与 watch-plugins.mjs 共用。
// 前端打包由 Rust 工具 mb-bundler（Oxc）完成，见 crates/mb-bundler。

import { execFileSync } from "node:child_process";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const pluginsRoot = path.join(repoRoot, "Plugins");

/** 全部磁盘插件清单（迁移完成一个加一个；与根 Cargo.toml workspace 成员对应） */
export const PLUGINS = [
  { id: "lottery", crate: "mimibox-plugin-lottery", frontend: true },
  { id: "tier-list", crate: "mimibox-plugin-tierlist", frontend: true },
  { id: "prediction", crate: "mimibox-plugin-prediction", frontend: true },
  { id: "rating", crate: "mimibox-plugin-rating", frontend: true },
  { id: "bobing", crate: "mimibox-plugin-bobing", frontend: true },
  { id: "whiteboard", crate: "mimibox-plugin-whiteboard", frontend: true },
  { id: "bilibili-comments", crate: "mimibox-plugin-bilibili-comments", frontend: true },
  { id: "bilibili-upload", crate: "mimibox-plugin-bilibili-upload", frontend: true },
  { id: "danmaku", crate: "mimibox-plugin-danmaku", frontend: true },
  { id: "anime", crate: "mimibox-plugin-anime", frontend: true },
];

/** 前端打包：调用 Rust 工具 mb-bundler（与 CI、应用内现场编译同一实现） */
export function bundleFrontend(plugin) {
  const entry = path.join(pluginsRoot, plugin.id, "frontend", "index.tsx");
  const outfile = path.join(pluginsRoot, plugin.id, "frontend", "index.js");
  execFileSync(
    "cargo",
    ["run", "--release", "-p", "mb-bundler", "--bin", "mb-bundler", "--", entry, plugin.id, outfile],
    { cwd: repoRoot, stdio: "inherit" },
  );
}
