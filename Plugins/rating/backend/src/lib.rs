//! 评分插件后端：批量导入选项并打 1-10 分的方案。
//!
//! 数据保存在应用数据目录 `rating.json`（沿用插件化前的文件名，无数据迁移）。
//! 命令与插件化前完全同名，行为不变。评分（`score`）为 1-10 的一位小数，
//! `None` 表示尚未评分。

use mimibox_plugin::{export_plugin, store, InvokeCtx, PluginBackend, Registry};
use serde::{Deserialize, Serialize};

/// 评分条目：名称 + 评分（1-10 一位小数，None 未评）+ 添加时间（ms 时间戳）
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RatingItem {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub score: Option<f64>,
    #[serde(default)]
    pub created_at: u64,
}

/// 评分方案：一批待评选项
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RatingScheme {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub items: Vec<RatingItem>,
}

/// 保存到应用数据目录 rating.json 的完整数据
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RatingData {
    #[serde(default)]
    pub schemes: Vec<RatingScheme>,
    #[serde(default)]
    pub active_scheme_id: Option<String>,
}

const FILE: &str = "rating.json";
const LABEL: &str = "评分数据";

struct RatingPlugin;

impl PluginBackend for RatingPlugin {
    fn register(&self, registry: &mut Registry) {
        registry.handle("rating_load", |ctx: InvokeCtx, _args: ()| async move {
            store::load::<RatingData>(&*ctx.host, FILE, LABEL)
        });

        registry.handle("rating_save", |ctx: InvokeCtx, data: RatingData| async move {
            store::save(&*ctx.host, FILE, LABEL, &data)
        });
    }
}

export_plugin!(RatingPlugin);
