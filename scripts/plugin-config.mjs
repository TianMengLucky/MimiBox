// 插件构建共享配置：build-plugins.mjs 与 watch-plugins.mjs 共用。

import path from "node:path";

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

/** esbuild 外置依赖：与 src/core/shared.ts 的共享模块表一一对应 */
export const EXTERNAL = [
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

/** 单插件前端 esbuild 选项（bundle 以 CJS 工厂注册到 window.__mb_plugins） */
export function esbuildFrontendOptions(id) {
  return {
    entryPoints: [path.join("Plugins", id, "frontend", "index.tsx")],
    outfile: path.join("Plugins", id, "frontend", "index.js"),
    bundle: true,
    format: "cjs",
    jsx: "automatic",
    target: "es2022",
    external: EXTERNAL,
    // 插件样式全部使用宿主样式表（Tailwind @source 扫描 Plugins 源码），
    // 插件源码里不应 import css；保险起见按空实现处理
    loader: { ".css": "empty" },
    // CJS 输出没有 import.meta：以常量替换 DEV 分支（死代码消除）
    define: { "import.meta.env.DEV": "false" },
    banner: {
      js: `window.__mb_plugins=window.__mb_plugins||{};window.__mb_plugins[${JSON.stringify(id)}]=function(require,module,exports){`,
    },
    footer: { js: "}" },
  };
}
