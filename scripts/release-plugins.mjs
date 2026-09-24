#!/usr/bin/env node
// CI 增量发布：对比 Release 上已发布的 .mip 版本与本地 plugin.json 的 version，
// 只重建并上传有变化的插件；未变化的插件复用 Release 现有资产，跳过构建。
//
// 用法（CI）：node scripts/release-plugins.mjs <release-tag>
// 依赖：gh（GITHUB_TOKEN 由步骤 env 提供）、tar（bsdtar，读取 .mip 内清单）。

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { PLUGINS } from "./plugin-config.mjs";

const tag = process.argv[2];
if (!tag) {
  console.error("用法: node scripts/release-plugins.mjs <release-tag>");
  process.exit(1);
}
const repo = process.env.GITHUB_REPOSITORY;

function gh(cmd) {
  return execSync(`gh ${cmd}`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

/** 读取 .mip 包内 plugin.json 的 version（bsdtar -O 输出到 stdout）。
 * cwd 切到文件所在目录、只用文件名传给 tar：bsdtar 会把绝对路径里的
 * `D:` 盘符当作「远程主机:路径」语法导致读取失败。 */
function readMipVersion(mipPath) {
  // 非 zip（PK 头）的旧资产无法被应用导入，按「版本未知」处理以触发重发布
  const head = Buffer.alloc(4);
  const fd = fs.openSync(mipPath, "r");
  try {
    fs.readSync(fd, head, 0, 4, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (head.toString("latin1") !== "PK\u0003\u0004") return "";
  const dir = path.dirname(mipPath);
  const name = path.basename(mipPath);
  const json = execSync(`tar -xOf "${name}" plugin.json`, {
    encoding: "utf8",
    cwd: dir,
  });
  return JSON.parse(json).version ?? "";
}

// 1. 下载 Release 上现有的 .mip（首次发布时 Release 尚不存在 → 全部按需发布）
const remoteDir = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP ?? ".", "mip-"));
const remoteVersions = {};
try {
  gh(`release download ${tag} -D ${remoteDir} -p "*.mip" --clobber -R ${repo}`);
  for (const file of fs.readdirSync(remoteDir).filter((f) => f.endsWith(".mip"))) {
    const id = path.basename(file, ".mip");
    remoteVersions[id] = readMipVersion(path.join(remoteDir, file));
  }
} catch {
  console.log("Release 上暂无可比对的 .mip（首次发布或资产缺失），全部插件按需发布");
}

// 2. 逐插件对比版本：未变化 → 跳过；变化/新增 → 构建 + 打包 + 收集上传
const uploads = [];
for (const plugin of PLUGINS) {
  const manifestPath = path.join("Plugins", plugin.id, "plugin.json");
  const localVersion = JSON.parse(fs.readFileSync(manifestPath, "utf8")).version ?? "";
  if (remoteVersions[plugin.id] === localVersion) {
    console.log(`[plugin:${plugin.id}] 版本 ${localVersion} 未变化，跳过构建与上传`);
    continue;
  }
  console.log(
    `[plugin:${plugin.id}] 版本 ${remoteVersions[plugin.id] || "（新插件）"} → ${localVersion}，构建中…`,
  );
  execSync(`node scripts/build-plugins.mjs ${plugin.id}`, { stdio: "inherit" });
  // .mip 由 build-plugins.mjs 生成在 Plugins/ 直下（Plugins/<id>.mip，非插件子目录）
  uploads.push(`Plugins/${plugin.id}.mip`);
}

// 3. 上传有变化的 .mip（--clobber 覆盖同名旧资产）
if (uploads.length > 0) {
  gh(`release upload ${tag} ${uploads.join(" ")} --clobber -R ${repo}`);
  console.log(`已上传 ${uploads.length} 个 .mip 到 Release ${tag}`);
} else {
  console.log("所有插件版本未变化，无需上传");
}
