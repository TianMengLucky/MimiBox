/**
 * 生成 src/icons.ts：扫描 src/ 源码里用到的 Iconify 图标，
 * 从 @iconify-json/* 数据包提取子集，交由 addCollection 离线注册，
 * 应用内图标不再依赖 api.iconify.design 网络。
 *
 * 新增/更换图标后运行 `pnpm icons` 重新生成。
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SETS = [
  { prefix: "lucide", pkg: "@iconify-json/lucide/icons.json" },
  { prefix: "mdi", pkg: "@iconify-json/mdi/icons.json" },
  { prefix: "simple-icons", pkg: "@iconify-json/simple-icons/icons.json" },
];

/** 递归收集 src 下的 ts/tsx 文件 */
function collectFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectFiles(full, acc);
    } else if (/\.(tsx?|jsx?)$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

/** 从源码文本提取 "prefix:name" 形式的图标名（仅图标名本身） */
function extractNames(text, prefix) {
  const names = new Set();
  const re = new RegExp(`["']${prefix}:([a-z0-9][a-z0-9-]*)["']`, "g");
  for (const match of text.matchAll(re)) {
    names.add(match[1]);
  }
  return names;
}

/** 解析别名：alias 指向的 parent 图标也要收进来 */
function collectWithAliases(full, names) {
  const icons = new Set();
  const aliases = new Set();
  const resolve = (name, seen = new Set()) => {
    if (seen.has(name)) return;
    seen.add(name);
    if (full.icons[name]) {
      icons.add(name);
      return;
    }
    const alias = full.aliases?.[name];
    if (alias) {
      aliases.add(name);
      resolve(alias.parent, seen);
    }
  };
  for (const name of names) resolve(name);
  return { icons, aliases };
}

const sourceFiles = collectFiles("src");
const blocks = [];
for (const set of SETS) {
  set.names = new Set();
  for (const file of sourceFiles) {
    for (const name of extractNames(readFileSync(file, "utf8"), set.prefix)) {
      set.names.add(name);
    }
  }
  if (set.names.size === 0) continue;

  const full = JSON.parse(readFileSync(`node_modules/${set.pkg}`, "utf8"));
  const { icons, aliases } = collectWithAliases(full, set.names);
  const missing = [...set.names].filter((n) => !icons.has(n) && !aliases.has(n));
  for (const name of missing) console.warn(`[${set.prefix}] 源码引用但数据包缺失: ${name}`);

  const data = {
    prefix: full.prefix,
    width: full.width,
    height: full.height,
    icons: Object.fromEntries([...icons].sort().map((n) => [n, full.icons[n]])),
    ...(aliases.size
      ? { aliases: Object.fromEntries([...aliases].sort().map((n) => [n, full.aliases[n]])) }
      : {}),
  };
  blocks.push(`addCollection(${JSON.stringify(data, null, 2)} as IconifyJSON);`);
}

const output = `// 由 scripts/generate-icons.mjs 自动生成（pnpm icons），请勿手改。
// 项目用到的 Iconify 图标离线子集：避免运行时依赖 api.iconify.design（网络不稳会导致图标空白）。
import { addCollection } from "@iconify/react";
import type { IconifyJSON } from "@iconify/react";

${blocks.join("\n\n")}
`;

writeFileSync("src/icons.ts", output);
console.log(
  `已生成 src/icons.ts：${SETS.map((s) => `${s.prefix}=${s.names.size}`).join("，")}`,
);
