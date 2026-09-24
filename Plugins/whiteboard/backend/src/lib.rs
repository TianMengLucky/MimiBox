//! 白板插件后端：背景图与可自由摆放的贴图条目。
//!
//! 数据保存在应用数据目录 `whiteboard.json`（沿用插件化前的文件名，无数据迁移）。
//! 命令与插件化前完全同名，行为不变。

use mimibox_plugin::{export_plugin, store, InvokeCtx, PluginBackend, Registry};
use serde::{Deserialize, Serialize};

/// 背景图：前端压缩后的 JPEG data URL + 压缩后的像素尺寸（用于按 contain 计算显示区域）
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BoardBackground {
    pub image: String,
    pub width: u32,
    pub height: u32,
}

/// 贴图条目：图片（PNG data URL）+ 相对背景显示区域的比例坐标（0-1）。
/// `x`/`y` 为贴图左上角位置，`width` 为贴图宽度占背景宽度的比例，
/// `ratio` 为贴图高宽比（高/宽），由前端在导入时读取原图尺寸写入。
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BoardItem {
    pub id: String,
    pub image: String,
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default = "default_item_width")]
    pub width: f64,
    #[serde(default = "default_item_ratio")]
    pub ratio: f64,
}

fn default_item_width() -> f64 {
    0.18
}

fn default_item_ratio() -> f64 {
    1.0
}

/// 保存到应用数据目录 whiteboard.json 的完整数据
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WhiteboardData {
    #[serde(default)]
    pub background: Option<BoardBackground>,
    #[serde(default)]
    pub items: Vec<BoardItem>,
}

const FILE: &str = "whiteboard.json";
const LABEL: &str = "白板数据";

struct WhiteboardPlugin;

impl PluginBackend for WhiteboardPlugin {
    fn register(&self, registry: &mut Registry) {
        registry.handle("whiteboard_load", |ctx: InvokeCtx, _args: ()| async move {
            store::load::<WhiteboardData>(&*ctx.host, FILE, LABEL)
        });

        registry.handle(
            "whiteboard_save",
            |ctx: InvokeCtx, data: WhiteboardData| async move {
                store::save(&*ctx.host, FILE, LABEL, &data)
            },
        );
    }
}

export_plugin!(WhiteboardPlugin);
