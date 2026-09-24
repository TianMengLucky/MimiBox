# Changelog

本项目的所有重要变更都记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.2.1] - 2026-09-24

### Added

- B 站评论区支持展开楼中楼回复：评论下方「共 N 条回复」按钮按需拉取该楼的 B 站回复列表（每页 20 条，可继续「加载更多」），楼中楼回复只读展示头像、昵称、内容与时间/点赞
- 评论正文支持 B 站表情：`[dog]` 等表情文本自动替换为官方表情图片，并按 B 站尺寸档位（小/大/超大）渲染
- 支持图片评论：评论附带的图片直接内联展示（单图大图查看、多图平铺）
- 本地备注的显示内容同样支持表情与图片渲染
- 新增 `pnpm tauri:local` 脚本：本地构建完整安装包时通过 `src-tauri/tauri.local.json` 关闭更新器产物生成，无需签名私钥；正式发布仍走 CI 签名构建

### Changed

- 发布流水线明确双产品线约定：`vX.Y.Z` tag 走主产品线（mimibox，更新源 `releases/latest`），`-x` 后缀 tag 属于插件产品线（MimiBox-X，从 plugin-architecture 分支发布到固定 `x-latest` prerelease，更新源互不干扰）；主分支工作流遇到 `-x` tag 立即失败并提示，避免两条产品线互相覆盖

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

[Unreleased]: https://github.com/TianMengLucky/MimiBox/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/TianMengLucky/MimiBox/releases/tag/v0.2.1
[0.2.0]: https://github.com/TianMengLucky/MimiBox/releases/tag/v0.2.0
[0.1.0]: https://github.com/TianMengLucky/MimiBox/releases/tag/v0.1.0
