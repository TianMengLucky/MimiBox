<!-- 美美工具箱 X README — 粉色治愈系主题（横幅为图片：GitHub 不支持在 Markdown/HTML 中使用内联 CSS 上色） -->

<p align="center">
  <img src="./docs/readme-header.png" alt="美美工具箱 — 粉色治愈系桌面工具箱横幅" width="1000" />
</p>

> 💡 「美美」是《与你相恋到生命尽头》中一名粉色可爱小女孩。
>
> 🧩 本分支（`plugin-architecture`）是应用的**插件化架构版本**：应用更名为 **MimiBox-X**，全部功能拆分为独立插件，从 `Plugins/` 目录运行时动态加载。

---

## ✨ 特性

<div align="center">
  <table>
    <tr>
      <td align="center" width="25%">
        <div style="font-size: 2rem; margin-bottom: 6px;">🎀</div>
        <strong style="color: #66535a;">粉色治愈系 UI</strong>
        <p style="margin: 4px 0 0; color: #9b8a91; font-size: 0.85rem;">温暖柔和的粉色主题<br />精致毛玻璃效果</p>
      </td>
      <td align="center" width="25%">
        <div style="font-size: 2rem; margin-bottom: 6px;">🧩</div>
        <strong style="color: #66535a;">插件化架构</strong>
        <p style="margin: 4px 0 0; color: #9b8a91; font-size: 0.85rem;">宿主内核 + 独立插件<br />功能即插即用，界面数据驱动</p>
      </td>
      <td align="center" width="25%">
        <div style="font-size: 2rem; margin-bottom: 6px;">🖥️</div>
        <strong style="color: #66535a;">跨平台桌面应用</strong>
        <p style="margin: 4px 0 0; color: #9b8a91; font-size: 0.85rem;">基于 Tauri 2<br />支持 Windows / macOS / Linux</p>
      </td>
      <td align="center" width="25%">
        <div style="font-size: 2rem; margin-bottom: 6px;">⚡</div>
        <strong style="color: #66535a;">轻量高性能</strong>
        <p style="margin: 4px 0 0; color: #9b8a91; font-size: 0.85rem;">Rust 后端驱动<br />体积极小，启动飞快</p>
      </td>
      <td align="center" width="25%">
        <div style="font-size: 2rem; margin-bottom: 6px;">🔐</div>
        <strong style="color: #66535a;">多平台多账号</strong>
        <p style="margin: 4px 0 0; color: #9b8a91; font-size: 0.85rem;">Bilibili 扫码/短信登录<br />抖音扫码 + 短信二次验证</p>
      </td>
    </tr>
  </table>
</div>

---

## 🧩 插件一览

每个功能都是一个独立插件（Rust cdylib 后端 + esbuild 前端 bundle + `plugin.json` 清单），由宿主在启动时扫描 `Plugins/` 目录动态加载：

| 插件 | 说明 | 依赖 |
| :--- | :--- | :--- |
| 🎁 lottery · 抽奖 | 自定义奖品（含图片上传）、幸运转盘、老虎机与抽奖历史 | — |
| 🏆 tier-list · 夯到拉 | 图片拖拽排名表（Tier List），支持导出成图分享 | — |
| 🏅 prediction · 赛事预测 | 电竞赛程晋级节点图，选项拖拽编排、比分编辑与多方案保存 | — |
| ⭐ rating · 评分 | 批量导入选项打 1-10 分，支持方案保存与 `.miz` 导入导出 | — |
| 🎲 bobing · 博饼 | 中秋传统掷骰游戏，骰子动画、状元彩头判定与掷骰历史 | — |
| 🖼️ whiteboard · 白板 | 背景图上自由摆放、拖动、缩放贴图 | — |
| 💬 bilibili-comments · B站评论区 | 查看自己投稿的评论，灌水识别、标记筛选、本地备注与回复 | account |
| 📺 bilibili-upload · B站投稿 | 视频分片上传、封面上传与一键投稿，实时进度 | account |
| 🎀 danmaku · 弹幕直播姬 | 连接直播间实时弹幕，独立悬浮窗口展示 | account |
| 📺 anime · 番剧 | Bangumi 每日放送时间表，注册到资料库 | — |

内置插件随宿主直接加载（不经过 dll）：**account**（Bilibili/抖音多账号管理，向其他插件提供账号凭据服务）、**scheme-io**（`.miz` 方案包导入导出，跨插件共用）。

除随应用分发的插件外，还可以在**设置 → 插件**中把第三方插件导入应用（见[安装第三方插件](#%EF%B8%8F-安装第三方插件)）。

---

## 🏗️ 架构

应用拆分为「宿主内核 + 插件」：

```
┌─ Rust 宿主（src-tauri）──────────────────────┐
│ Tauri Builder + 系统托盘 + 6 个官方插件        │
│ cordis 运行时（生命周期 / 服务依赖 / 事件）      │
│ 插件加载器：扫描 Plugins/，libloading 加载 dll  │
│ 动态网关：plugin_invoke / plugin_list          │
│ mbplugin:// 协议：向窗口提供插件前端 bundle      │
│ 内置插件：account（账号服务）、scheme-io        │
├─ Plugins/<id>/ ─────────────────────────────┤
│ plugin.json  backend.dll  frontend/index.js   │
└──────────────────────────────────────────────┘
┌─ 前端宿主（src）─────────────────────────────┐
│ 功能注册表 → home/library 卡片数据驱动渲染       │
│ 通用路由 /feature/$plugin、/w/$plugin          │
│ 共享模块表：插件与宿主共享同一 React 实例        │
└──────────────────────────────────────────────┘
```

- **宿主只保留 4 个静态命令**（首启标记、欢迎已读、插件网关、插件清单），其余全部命令经 `plugin_invoke(插件, 命令, 参数)` 动态分发。
- 插件前端通过 esbuild 打包为 CJS 工厂注入运行，React / HeroUI 等依赖由宿主共享模块表提供，**杜绝双 React**；lucky-canvas、xyflow 等单插件依赖打包进插件自身。
- 插件清单 `requires: ["account"]` 映射为 cordis 服务依赖：账号服务就绪前，B 站内容类插件自动等待（Pending），就绪后自动收敛为可用。
- 插件数据沿用应用数据目录下的同名 JSON 文件（`lottery.json`、`accounts.json` 等），升级零数据迁移。

---

## 🛠️ 技术栈

| 层级 | 技术 |
| :--- | :--- |
| 前端框架 | React 19 + TypeScript |
| 构建工具 | Vite（宿主）/ esbuild（插件 bundle） |
| UI 组件库 | HeroUI React v3 |
| 样式方案 | Tailwind CSS v4 |
| 路由 | TanStack React Router |
| 动效 | motion（framer-motion 继任者） |
| 前端插件运行时 | @cordisjs/core |
| 桌面框架 | Tauri 2 |
| 后端语言 | Rust |
| 插件运行时 | cordis-rs + libloading（C ABI 动态加载） |
| 包管理器 | pnpm |

---

## 📁 项目结构

```
MimiBox/
├── crates/
│   └── mimibox-plugin/      # 插件 SDK（宿主与插件共用：C ABI + 命令注册 + JSON 存储）
├── Plugins/                 # 插件源码与构建产物（每个插件一个目录）
│   └── <id>/
│       ├── plugin.json      # 插件清单（id/标题/图标/依赖/入口）
│       ├── backend/         # Rust cdylib 后端（workspace 成员）
│       │   └── src/lib.rs   # 实现 PluginBackend，export_plugin! 导出
│       ├── frontend/        # TS/TSX 前端源码（defineMbPlugin 注册功能）
│       ├── backend.dll      # 构建产物（git 忽略）
│       └── frontend/index.js # 构建产物（git 忽略）
├── src/                     # 前端宿主（外壳 + 运行时 + 核心页）
│   ├── core/                # 插件运行时：共享模块表、功能注册表、defineMbPlugin、加载器
│   ├── components/          # 宿主组件（标题栏、账号页、主页卡片、设置等）
│   ├── routes/              # 页面路由（home/account/settings + /feature/$plugin、/w/$plugin）
│   ├── lib/                 # tauriInvoke/pluginInvoke 网关入口、格式化与拖拽工具
│   ├── icons.ts             # Iconify 图标离线子集
│   └── style/               # 页面样式 + 插件外接样式引入
├── src-tauri/               # Tauri Rust 宿主
│   ├── src/
│   │   ├── runtime/         # cordis 运行时：命令注册表服务、宿主能力、FFI vtable
│   │   ├── builtin/         # 内置插件：core（基础设施）、account、scheme-io
│   │   ├── loader.rs        # 磁盘插件加载器（清单解析 + ABI 校验 + dll 加载）
│   │   ├── gateway.rs       # 动态网关命令 plugin_invoke / plugin_list
│   │   ├── account/         # 账号模块（Bilibili/抖音登录，被内置 account 插件复用）
│   │   ├── douyin_web/      # 抖音 web 扫码登录（协议参数 + 短信 MFA）
│   │   ├── douyin_signer/   # 抖音 a_bogus 签名 + DTrait 指纹（QuickJS）
│   │   ├── scheme_io.rs     # .miz 方案包读写（内置 scheme-io 插件复用）
│   │   ├── lib.rs           # Tauri 初始化、mbplugin:// 协议、插件运行时装配
│   │   └── main.rs          # 桌面应用入口
│   ├── capabilities/        # Tauri 权限声明（含弹幕悬浮窗）
│   ├── icons/               # 应用图标（多平台）
│   └── tauri.conf.json      # Tauri 配置（resources 打包 Plugins/）
├── scripts/
│   ├── build-plugins.mjs    # 插件构建编排（cargo cdylib + esbuild → Plugins/）
│   ├── watch-plugins.mjs    # 插件前端增量监听
│   └── generate-icons.mjs   # Iconify 图标离线子集生成
├── AGENTS.md                # 仓库 Agent 指令（含插件开发约定）
└── CHANGELOG.md             # 变更日志
```

---

## 🚀 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) >= 20.19（推荐使用 22.x LTS，Vite 8 要求）
- [pnpm](https://pnpm.io/) >= 9（项目锁定版本为 12，见 `package.json` 的 `packageManager`）
- [Rust](https://www.rust-lang.org/tools/install)（Tauri 与插件编译依赖）
- 对应平台的编译工具链（Windows 需要 Visual Studio Build Tools）

### 安装依赖

```bash
pnpm install
```

### 开发模式

```bash
# 首次或插件后端有改动后，先构建插件（dll + 前端 bundle）
pnpm build:plugins

# 启动完整应用
pnpm tauri dev
```

插件前端改动时，另开一个终端运行 `pnpm plugins:watch`，保存后刷新应用窗口即可生效；**Rust dll 改动需要重启应用**（Windows 会锁定已加载的 dll）。

### 构建生产版本

```bash
# 完整构建（tsc + vite + 插件构建），通常由 tauri beforeBuildCommand 自动执行
pnpm build

# 构建桌面应用安装包（正式发布，需要 TAURI_SIGNING_PRIVATE_KEY，仅 CI 提供）
pnpm tauri build

# 本地构建完整安装包（关闭更新器签名，无需私钥）
pnpm tauri:local
```

安装包会把 `Plugins/` 目录一并打包（tauri.conf.json 的 `resources`），发布态从资源目录加载插件。

### 仅前端开发

如果只需要调试宿主界面，可以运行：

```bash
pnpm dev
```

然后在浏览器中访问 `http://localhost:1420`（插件仅在 Tauri 环境加载）。

### 账号登录说明

账号页支持 Bilibili 与抖音两个平台。登录成功后，应用会将多账号所需的 Cookie 凭据保存在 Tauri 应用数据目录的 `accounts.json`，并在下次启动时恢复当前账号。每次进入账号页，后端都会重新检查各账号的登录状态；头像状态点分别表示凭证有效、已过期或网络异常。头像由后端代理为内嵌图片，避免图片 CDN 的防盗链影响显示。

右键点击当前账号头像可以退出登录，或在独立的网页窗口中打开当前账号。网页登录凭证由 Rust 直接写入隔离的 WebView Cookie Store，不会拼接到 URL，也不会返回给前端脚本。不同账号使用独立的 WebView 配置目录，避免登录状态互相覆盖。

**Bilibili**：支持扫码登录、短信登录和账号密码登录。短信与密码登录会在应用页面内加载 Bilibili Geetest 人机验证，完成验证后才能发送短信或提交登录。

**抖音**：支持扫码登录。后端通过 QuickJS 承载官方 bdms 1.0.1.20 与 dtrait 1.0.29 JavaScript SDK 生成 a_bogus 签名与设备指纹安全头，完成 web 协议握手与轮询。若账号触发 2046 短信二次验证，后端自动发送验证码并暂停轮询，前端弹出验证卡片供用户输入 6 位验证码；验证通过后自动续跑轮询完成登录。对于未开启手机短信验证的账号（如仅人脸验证），前端会显示引导提示，指引用户前往抖音 App 完成验证后重新扫码。

登录功能依赖网络连接，并受各平台的风控、验证码和服务条款约束。应用不会绕过人机验证。

### 闲置屏保

应用在长时间无操作后会进入日期与时间屏保。点击任意位置或按下任意按键即可返回，不影响当前页面状态。

### 安装第三方插件

在 **设置 → 插件** 中可以把第三方开发的插件导入应用，两种方式：

- **从文件夹导入**：选择一个内含 `plugin.json` 与后端动态库的插件目录（如插件开发仓库的构建产物目录）；
- **从 `.mip` 插件包导入**：选择 `.mip` 文件（zip 格式的插件分发包，包内根目录或唯一子目录下有 `plugin.json`、`backend.dll` 与可选的 `frontend/index.js`）。

导入时宿主会校验插件清单与 ABI 版本（`abi: 1`），通过后复制到插件存放位置（默认为应用数据目录下的 `plugins/`，可在设置中自定义，见下）。**导入或删除后需要重启应用生效**，设置页提供一键重启按钮。

说明：

- 同一 id 重复导入视为升级，覆盖旧版本；若该插件正在运行（dll 被占用），会提示先重启再导入；
- 用户导入的插件优先于随应用分发的插件加载——可以用来升级官方插件；
- 用户导入的插件可在设置中删除；随应用分发的插件不可删除；
- **插件存放位置可自定义**：设置页「插件存放位置」可改为任意文件夹（切换时已导入的插件自动迁移到新位置），也可一键恢复默认；
- 插件是信任代码，应用不做沙箱隔离，请只导入可信来源的插件。

---

## 🧑‍💻 插件开发

新增一个插件只需要三步（完整约定见 [AGENTS.md](./AGENTS.md) 的「Plugin architecture」章节）：

1. 创建 `Plugins/<id>/`：`plugin.json` 清单（`requires` 声明依赖如 `["account"]`）、`backend/`（实现 `mimibox_plugin::PluginBackend`，用 `Registry::handle` 注册命令，`export_plugin!` 导出）、`frontend/`（`export default defineMbPlugin({ apply(ctx) { ctx.registerFeature({ component }) } })`）。
2. 在根 `Cargo.toml` 的 workspace members 与 `scripts/plugin-config.mjs` 的 `PLUGINS` 中登记。
3. 运行 `pnpm build:plugins` 后启动应用，主页/资料库卡片与 `/feature/<id>` 页面会自动出现。

把插件目录打包为 `.mip` 分发包：运行 `node scripts/build-plugins.mjs --mip-only`（或任意一次 `pnpm build:plugins`），每个插件会在 `Plugins/` 下生成 `<id>.mip`（zip 格式，仅含 plugin.json、backend.dll、frontend/index.js）。CI 发布时会把全部 `.mip` 与安装包一起上传到 Release 供下载。

### 发行版与增量发布

CI（tag 触发）每次产出两类安装包：

- **完整版**（`MimiBox-X_版本_x64-setup.exe`）：内置全部插件，开箱即用；
- **Lite 精简版**（`MimiBox-X-Lite_版本_x64-setup.exe`）：不含插件、禁用应用内更新，安装后通过设置页导入所需的 `.mip`。

增量规则：应用本体按 Release 上 `latest.json` 的版本对比，插件按各自 `plugin.json` 的 `version` 字段对比——未变化的组件自动跳过构建与上传，因此更新单个插件只需在对应 `plugin.json` 里递增 `version` 后打 tag。

---

## 📜 可用脚本

| 命令 | 说明 |
| :--- | :--- |
| `pnpm dev` | 启动 Vite 开发服务器 |
| `pnpm build` | 完整构建：tsc + vite + 插件构建 |
| `pnpm build:plugins` | 构建全部插件（cargo cdylib + esbuild → `Plugins/`） |
| `pnpm plugins:watch` | 监听插件前端改动并增量重打包 |
| `pnpm preview` | 预览前端构建结果 |
| `pnpm tauri dev` | 启动 Tauri 开发模式（含热更新） |
| `pnpm tauri build` | 构建桌面应用安装包（正式发布，需签名私钥） |
| `pnpm tauri:local` | 本地构建完整安装包（关闭更新器签名，无需私钥） |
| `pnpm icons` | 重新生成 Iconify 图标离线子集（新增图标后必须执行，否则线上图标加载失败） |

---

## 🎨 设计规范

**主色调**

| 颜色 | 色值 | 用途 |
| :--- | :--- | :--- |
| 主粉色 | `#f5b3c9` | 按钮、强调色 |
| 浅粉色 | `#f6e3e1` | 背景、次要元素 |
| 渐变粉 | `#ffdde9` | 渐变、装饰 |

**文字颜色**

| 层级 | 色值 |
| :--- | :--- |
| 标题 | `#66535a` |
| 正文 | `#7b686f` |
| 辅助 | `#9b8a91` |

**视觉风格**

- 圆角：大圆角设计，按钮使用胶囊形状 (`999px`)
- 阴影：柔和的粉色投影
- 毛玻璃：`backdrop-filter: blur(12px) saturate(1.4)`

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

## 📚 参考

本项目在开发过程中参考了以下开源项目：

- [jumpbyte-bot](https://github.com/sisi0318/jumpbyte-bot)
- [douyin-web-qr-login](https://github.com/Caviar9/douyin-web-qr-login)
- [bpi-rs](https://github.com/Yuelioi/bpi-rs)
- [cordis](https://github.com/cordiverse/cordis) / [cordis-rs](https://github.com/dshbox/cordis-rs)（插件化运行时）

---

## ⚠️ 免责声明（宇宙免责协议）

> 本项目仅供学习、研究与技术交流，严禁用于任何商业、违法或滥用场景。
>
> 请勿用于窥探、骚扰、爬取或侵犯任何第三方。
>
> 一经下载 / 编译 / 运行本项目，即视为你已完全知悉并同意：由此产生的一切后果统统由你自己承担，与作者、贡献者、GitHub 及一切相关方无关。
>
> 本项目与任何平台 / 公司没有任何关联，非官方、未获授权、不代表其立场，所有商标归各自所有者。
>
> 请自行遵守你所在地的法律法规以及相关平台的服务条款；因违反而产生的任何责任由使用者独自承担。
>
> 依据 GPLv3，本软件按「原样」提供，不附带任何明示或暗示的担保（包括适销性、特定用途适用性、不侵权等）。
>
> 作者可能随时删库跑路，本声明拥有横跨三次元的最终解释权。不接受即刻删除，接受请继续。
>
> —— 声明参考：思思姐姐

---

<p align="center">
  <img src="./docs/readme-footer.png" alt="Made with ♥ by MimiBox Team · GNU GPL v3.0" width="1000" />
</p>
