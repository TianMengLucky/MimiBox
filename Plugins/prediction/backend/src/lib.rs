//! 赛事预测插件后端：选项库、晋级节点图与方案。
//!
//! 数据保存在应用数据目录 `prediction.json`（沿用插件化前的文件名，无数据迁移）。
//! 命令与插件化前完全同名，行为不变。节点席位（`PredictionSlot`）只引用
//! 选项 id，同一选项可出现在多个节点（复制语义）。

use mimibox_plugin::{export_plugin, store, InvokeCtx, PluginBackend, Registry};
use serde::{Deserialize, Serialize};

/// 选项：队伍/选手条目，名称 + 可选图片（前端压缩后的 PNG data URL）
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PredictionEntry {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub image: Option<String>,
}

/// 节点上的一个席位：引用选项 + 比分；entry_id 为空表示空位
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PredictionSlot {
    #[serde(default)]
    pub entry_id: Option<String>,
    #[serde(default)]
    pub score: String,
}

/// 一个比赛节点：标题（如场次/时间）+ 若干席位
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PredictionNode {
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub slots: Vec<PredictionSlot>,
}

/// 节点列（轮次/分组）：名称 + 节点列表
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PredictionRound {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub nodes: Vec<PredictionNode>,
}

/// 节点间连线（晋级关系）：source → target，均为节点 id
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PredictionLink {
    pub id: String,
    pub source: String,
    pub target: String,
}

/// 节点手动摆放的坐标（画布左上角原点）
#[derive(Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct PredictionPoint {
    pub x: f64,
    pub y: f64,
}

/// 方案背景：纯色/渐变 CSS 值 + 可选背景图（前端压缩后的 JPEG data URL）
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SchemeBackground {
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub image: Option<String>,
}

/// 预测方案：选项库 + 晋级节点图
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PredictionScheme {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub entries: Vec<PredictionEntry>,
    #[serde(default)]
    pub rounds: Vec<PredictionRound>,
    #[serde(default)]
    pub links: Vec<PredictionLink>,
    /// 手动拖拽过的节点坐标；缺省节点由前端 dagre 自动布局
    #[serde(default)]
    pub positions: std::collections::HashMap<String, PredictionPoint>,
    #[serde(default)]
    pub background: SchemeBackground,
}

/// 保存到应用数据目录 prediction.json 的完整数据
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PredictionData {
    #[serde(default)]
    pub schemes: Vec<PredictionScheme>,
    #[serde(default)]
    pub active_scheme_id: Option<String>,
}

const FILE: &str = "prediction.json";
const LABEL: &str = "赛事预测数据";

struct PredictionPlugin;

impl PluginBackend for PredictionPlugin {
    fn register(&self, registry: &mut Registry) {
        registry.handle("prediction_load", |ctx: InvokeCtx, _args: ()| async move {
            store::load::<PredictionData>(&*ctx.host, FILE, LABEL)
        });

        registry.handle(
            "prediction_save",
            |ctx: InvokeCtx, data: PredictionData| async move {
                store::save(&*ctx.host, FILE, LABEL, &data)
            },
        );
    }
}

export_plugin!(PredictionPlugin);
