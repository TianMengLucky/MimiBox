#!/usr/bin/env node
// 清理固定 Release（x-latest）上残留的旧版本安装包资产。
// x-latest 跨 tag 复用：安装包文件名带版本号（如 MimiBox-X_0.2.2_x64-setup.exe），
// 新版本覆盖上传时文件名不同，旧资产会残留并误导下载。
// 规则：删除文件名中带「与当前版本不同的版本号」的资产；
// latest.json 与 *.mip（文件名不带版本，随发布覆盖）不受影响。
//
// 用法（CI）：node scripts/clean-release-assets.mjs <release-tag> <app-version>

import { execSync } from "node:child_process";

const [tag, version] = process.argv.slice(2);
if (!tag || !version) {
  console.error("用法: node scripts/clean-release-assets.mjs <release-tag> <app-version>");
  process.exit(1);
}
const repo = process.env.GITHUB_REPOSITORY;

function gh(cmd) {
  return execSync(`gh ${cmd}`, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

let assets = [];
try {
  assets = JSON.parse(gh(`release view ${tag} --json assets -R ${repo}`)).assets ?? [];
} catch {
  console.log("Release 不存在，跳过清理");
  process.exit(0);
}

const stale = assets
  .map((a) => a.name)
  .filter((name) => {
    const m = name.match(/_(\d+\.\d+\.\d+)_/);
    return m !== null && m[1] !== version;
  });

if (stale.length === 0) {
  console.log("没有残留的旧版本资产");
  process.exit(0);
}

let deleted = 0;
for (const name of stale) {
  // gh 的 release delete 只接受 1 个参数（删整个 Release），删单个资产用 delete-asset
  gh(`release delete-asset ${tag} "${name}" --yes -R ${repo}`);
  deleted++;
  console.log(`  已删除 ${name}`);
}
console.log(`共删除 ${deleted} 个旧版本资产`);
