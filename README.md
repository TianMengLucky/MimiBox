<!-- 美美工具箱 README — 粉色治愈系主题（横幅为图片：GitHub 不支持在 Markdown/HTML 中使用内联 CSS 上色） -->

<p align="center">
  <img src="./docs/readme-header.png" alt="美美工具箱 — 粉色治愈系桌面工具箱横幅" width="720" />
</p>

> 💡 「美美」是《与你相恋到生命尽头》中一名粉色可爱小女孩。

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
        <div style="font-size: 2rem; margin-bottom: 6px;">🧩</div>
        <strong style="color: #66535a;">模块化设计</strong>
        <p style="margin: 4px 0 0; color: #9b8a91; font-size: 0.85rem;">基于文件路由<br />易于扩展新功能</p>
      </td>
    </tr>
  </table>
</div>

---

## 🛠️ 技术栈

| 层级 | 技术 |
| :--- | :--- |
| 前端框架 | React 19 + TypeScript |
| 构建工具 | Vite |
| UI 组件库 | HeroUI React v3 |
| 样式方案 | Tailwind CSS v4 |
| 路由 | TanStack React Router |
| 桌面框架 | Tauri 2 |
| 后端语言 | Rust |
| 包管理器 | pnpm |

---

## 📁 项目结构

```
MimiBox/
├── src/                     # 前端源代码
│   ├── assets/              # 静态资源（图标、背景图）
│   ├── components/          # React 组件
│   │   ├── CornerDock.tsx   # 左下角悬浮操作坞
│   │   ├── ErrorFallback.tsx   # 错误降级界面
│   │   └── WelcomeScreen.tsx# 欢迎页
│   ├── routes/              # 页面路由（文件路由）
│   │   ├── __root.tsx       # 根布局
│   │   ├── home.tsx         # 主页
│   │   └── index.tsx        # 欢迎入口
│   ├── main.tsx             # 应用入口
│   ├── router.tsx           # 路由配置
│   └── App.css              # 全局样式
├── src-tauri/               # Tauri Rust 后端
│   ├── src/                 # Rust 源代码
│   ├── icons/               # 应用图标（多平台）
│   ├── Cargo.toml           # Rust 依赖配置
│   └── tauri.conf.json      # Tauri 配置
├── package.json             # 前端依赖
├── tsconfig.json            # TypeScript 配置
└── vite.config.ts           # Vite 配置
```

---

## 🚀 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) >= 20.19（推荐使用 22.x LTS，Vite 8 要求）
- [pnpm](https://pnpm.io/) >= 9（项目锁定版本为 12，见 `package.json` 的 `packageManager`）
- [Rust](https://www.rust-lang.org/tools/install)（Tauri 编译依赖）
- 对应平台的编译工具链（Windows 需要 Visual Studio Build Tools）

### 安装依赖

```bash
pnpm install
```

### 开发模式

```bash
pnpm tauri dev
```

首次运行会下载 Rust 依赖并编译，需要耐心等待。后续启动会快很多。

### 构建生产版本

```bash
pnpm tauri build
```

构建产物会输出到 `src-tauri/target/release/` 目录。

### 仅前端开发

如果只需要调试前端界面，可以运行：

```bash
pnpm dev
```

然后在浏览器中访问 `http://localhost:1420`。

---

## 📜 可用脚本

| 命令 | 说明 |
| :--- | :--- |
| `pnpm dev` | 启动 Vite 开发服务器 |
| `pnpm build` | 构建前端生产版本 |
| `pnpm preview` | 预览前端构建结果 |
| `pnpm tauri dev` | 启动 Tauri 开发模式（含热更新） |
| `pnpm tauri build` | 构建桌面应用安装包 |

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

<div align="center">
  <p style="color: #9b8a91; font-size: 0.85rem;">
    Made with 💗 by MimiBox Team
  </p>
  <p style="color: #cf829e; font-size: 0.8rem;">
    MIT License
  </p>
</div>
