# Changelog

本项目的所有重要变更都记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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

[Unreleased]: https://github.com/TianMengLucky/MimiBox/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/TianMengLucky/MimiBox/releases/tag/v0.1.0
