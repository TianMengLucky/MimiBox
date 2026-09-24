# Changelog

本项目的所有重要变更都记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.2.3-x] - 2026-09-25

> 注：安装包/应用内版本号为 `0.2.3`（X 产品线使用纯数字版本号，与主分支的区分由产品名 MimiBox-X 与发布渠道承担）。

### Added

- `.miz` / `.mip` 文件类型图标：安装包注册文件关联，资源管理器中 `.mip` 插件包与 `.miz` 方案包分别显示专属图标（图标随安装包分发，NSIS 安装器通过 installer hooks 覆盖关联的 DefaultIcon）

### Fixed

- 修复 `.mip` 分发包被 tar 工具按扩展名静默打包成 tar/pax 格式、应用内导入报「不是有效的 zip 插件包」的问题：打包显式指定 `--format zip`；增量发布检测到 Release 上非 zip 的旧资产时按「版本未知」处理，重建并以正确格式覆盖上传
- 修复 MSI 打包失败（light.exe `LGHT0311`）：文件关联的中文描述超出 en-US 数据库代码页 1252，改用自定义 WixLocalization（数据库代码页 936）支持中文

### Changed

- 应用与全部插件版本号统一升级到 `0.2.3`，触发全量插件 `.mip` 重发布，覆盖 x-latest 上损坏的旧资产
- `@tauri-apps/cli` 2.11.4 → 2.11.5

## [0.2.2-x] - 2026-09-24

> 注：安装包/应用内版本号为 `0.2.2`——MSI 打包要求版本号 pre-release 标识只能是纯数字，因此 X 产品线版本号使用纯数字形式，与主分支的区分由产品名（MimiBox-X）与发布渠道承担。

### Added

- 新增插件导入：设置页支持从文件夹或 `.mip` 插件包（zip 格式）安装第三方插件，导入时校验插件清单与 ABI 版本，可删除已导入的插件（重启应用生效）
- 插件加载支持双目录合并：用户导入目录（应用数据目录 `plugins/`）优先于随应用分发的插件目录，可用导入的插件升级官方插件
- 插件存放位置可自定义：设置页可更改插件目录（自动迁移已导入的插件，支持跨盘移动），可一键恢复默认位置
- CI 双发行版发布：完整版安装包（内置全部插件）与 Lite 精简版（`MimiBox-X-Lite`，不含插件、禁用应用内更新，通过 .mip 安装）同时产出
- 每个插件独立打包为 `.mip` 分发包并上传到 Release，可在设置页单独安装或升级
- CI 增量发布：应用本体按 latest.json 版本、插件按各自 `plugin.json` 的 `version` 字段与 Release 现有资产对比，未变化的部分自动跳过构建与上传
- 每个插件 `plugin.json` 新增独立 `version` 字段，作为增量发布与 `.mip` 分发的版本依据

### Fixed

- 修复 CI 构建失败：pnpm 12 构建脚本批准迁移到 `allowBuilds`（旧 `onlyBuiltDependencies` 已废弃被忽略）
- 修复 CI 构建失败：`@tauri-apps/plugin-updater` 升级到 2.12.0 与 Rust 侧版本对齐
- 修复 CI 构建失败：版本号改为纯数字 `0.2.2`（MSI 打包要求 pre-release 标识只能为纯数字，含字母的 `0.2.1-x` 无法通过 WiX 校验）
- 清除部分源文件误带的 UTF-8 BOM（会导致插件清单解析失败）

## [0.2.1-x] - 2026-09-24

本分支（`plugin-architecture`）将应用重构为「宿主内核 + 插件」架构，并更名为 **MimiBox-X**（版本号带 `-x` 后缀，与主分支构建区分）。

### Added

- 全新插件化架构：应用拆分为「宿主内核 + 插件」，Rust 端引入 cordis 运行时（生命周期 / 服务依赖 / 事件收敛），插件以独立 cdylib + 前端 bundle 形式从 `Plugins/` 目录动态加载，带 ABI 版本校验与 panic 隔离
- 全部 10 个功能迁移为独立插件：抽奖（lottery）、夯到拉（tier-list）、赛事预测（prediction）、评分（rating）、博饼（bobing）、白板（whiteboard）、B站评论区（bilibili-comments）、B站投稿（bilibili-upload）、弹幕直播姬（danmaku）、番剧（anime）；命令名、行为与数据文件全部保持不变，升级零数据迁移
- 内置插件机制：account（多账号管理，向其他插件发布账号就绪服务）与 scheme-io（`.miz` 方案包导入导出）随宿主进程内加载，B 站内容类插件在账号服务就绪前自动等待（Pending → Active 收敛）
- 动态网关命令 `plugin_invoke` / `plugin_list`：前端统一经网关调用任意插件命令；`mbplugin://` 自定义协议向各窗口提供插件前端 bundle
- 插件宿主能力（HostApi）：应用数据目录读写、Tauri 事件广播、B 站账号凭据获取、独立窗口创建与聚焦、资源管理器文件定位
- 前端插件运行时：功能注册表 + 共享模块表（插件与宿主共享单一 React 实例，杜绝双 React），插件以 `defineMbPlugin` 注册功能页面与独立窗口组件
- 主页与资料库改为按插件清单数据驱动渲染，新增 `/feature/$plugin` 通用功能页与 `/w/$plugin` 通用窗口路由，新增功能无需改动宿主界面与路由代码
- 插件构建管线：`pnpm build:plugins`（cargo cdylib + esbuild → `Plugins/<id>/`）、`pnpm plugins:watch` 前端增量监听；`pnpm build` 已包含插件构建
- 新增插件 SDK crate `mimibox-plugin`（C ABI + 类型化命令注册 + JSON 存储工具），插件与宿主同仓库同工具链构建
- 应用图标更换为全新粉色花环形象

### Changed

- 应用更名为 **MimiBox-X**（`productName`），界面品牌名同步为「美美工具箱 X」，版本号使用 `-x` 后缀与主分支构建区分（安装包名自动跟随）
- Rust 端静态命令收敛为 4 个（首启标记、欢迎已读、插件网关、插件清单），原 52 个功能命令全部改为经网关动态分发
- 插件前端以 esbuild CJS 工厂注入运行，React / HeroUI / motion 等依赖由宿主共享模块表提供
- pnpm 依赖构建脚本批准配置迁移至 `pnpm-workspace.yaml`（pnpm 12 新约定）
- CI 支持双分支发布：tag `vX.Y.Z` 构建主分支 MimiBox，tag `vX.Y.Z-x` 构建 MimiBox-X 并发布到固定 Release `x-latest`（prerelease），两条产品线的应用内更新源互相隔离

### Removed

- 移除宿主内嵌的全部功能模块代码（`src-tauri/src/{lottery,tierlist,prediction,rating,bobing,whiteboard,bangumi,bilibili_comments,bilibili_upload,bilibili_danmaku}` 与对应前端页面/组件），改由 `Plugins/` 目录的插件提供
- 移除旧静态功能路由 `/feature/<功能名>` 与 `/danmaku`，统一为 `/feature/$plugin`、`/w/$plugin` 通用路由

## [0.2.0] - 2026-09-22

### Added

- 应用更新界面加入过渡动画：检查/发现新版本/下载进度/安装重启等阶段平滑切换，图标弹性入场，下载进度显示百分比与已下载大小
- 页面加载占位加入品牌弹性动效：加载点改用 motion 动效库（framer-motion 继任者），账号页、评论区等加载状态统一使用同一占位组件
- 所有动效尊重系统「减弱动态效果」设置
- B 站评论区支持标记评论，并可一键「只看标记」筛选已标记的评论（标记按评论 rpid 持久化到 `comment_marks.json`，翻页或重进后仍保留）
- B 站评论区新增本地备注：可修改任意评论的显示内容（支持「查看原文」与一键还原），并可撰写仅本地显示的回复、挂在原评论下方，回复可再编辑或删除；修改与回复持久化到 `comment_notes.json`，不会同步到 B 站
- 出错界面新增「返回主页」按钮，可从崩溃页面直接回到主页

### Changed

- B 站评论区排序调整为「最热 / 最新 / 最晚」三项：按时间排序改用 B 站游标翻页接口（修复翻页与加载更多），「最晚」把已加载的评论从旧到新排列（置顶除外）

### Fixed

- 修复动画进行时背景掉帧卡顿的问题：背景图从 `background-attachment: fixed` 改为独立 fixed 定位层，只合成一次，动画帧不再强制整张背景重绘；同时入场动画改为从上方落下（-Y 位移），修复占满一屏的页面（主页/资料库/账号页等）切换时滚动条闪现导致的背景左右晃动
- 修复评论排序模式与 B 站接口语义相反的问题：原「最新」实际请求的是热度排序、「最热」实际是时间排序
- 修复评论区「加载更多」在已到末页后仍显示的问题（`is_end` 布尔值解析错误导致 hasMore 恒为真）

## [0.1.0] - 2026-09-20

首个公开发布版本。

### Added

- 新增番剧（bangumi）追番功能与 B 站评论查询/垃圾评论识别功能（`is_spam` 在 Rust 端计算）
- 新增预测（prediction）与评分（rating，`rating.json`）功能
- 新增弹幕相关功能模块（`src-tauri/src/bilibili_danmaku/`、弹幕页面与样式）
- 新增 B 站投稿（bilibili-upload）功能模块
- 新增白板功能（`whiteboard.json`）：可上传背景图片，并在背景上自由拖动、缩放、删除贴图
- 方案导入导出：`.miz` 方案包（zip，内含 `miz.json`），`kind` 校验限定导回对应功能
- 抽奖转盘、夯到拉、博饼等抽奖玩法，及应用内更新
- 抖音扫码登录、短信二次验证、登录态持久化（`douyin_state.json`）、抖音头像
- 多账号管理与应用界面（`accounts.json`）
- B 站相关功能与系统托盘（TrayIcon + 右键菜单）
- 自定义无边框标题栏（窗口控制组 + 品牌卡片）
- 闲置屏保、系统托盘等桌面体验
- 网页打开、Rust 端模块化拆分
- Tauri + React（TanStack Router）应用骨架，HeroUI 组件库

### Changed

- 网络层由 wreq 迁移到 reqwest
- 许可证确定为 GPLv3，README 添加免责声明

[Unreleased]: https://github.com/TianMengLucky/MimiBox/compare/v0.2.3-x...HEAD
[0.2.3-x]: https://github.com/TianMengLucky/MimiBox/releases/tag/v0.2.3-x
[0.2.2-x]: https://github.com/TianMengLucky/MimiBox/releases/tag/v0.2.2-x
[0.2.1-x]: https://github.com/TianMengLucky/MimiBox/releases/tag/v0.2.1-x
[0.2.0]: https://github.com/TianMengLucky/MimiBox/releases/tag/v0.2.0
[0.1.0]: https://github.com/TianMengLucky/MimiBox/releases/tag/v0.1.0
