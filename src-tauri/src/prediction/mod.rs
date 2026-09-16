//! 赛事预测（prediction.json）：选项库、晋级节点图与方案的类型与命令入口。
//!
//! - `PredictionData`：磁盘上的完整数据（方案列表 + 活动方案）
//! - `prediction_load`/`prediction_save`：整体读写的唯一入口，由前端在数据变化时保存
//!
//! 数据结构与前端 `src/components/prediction/types.ts` 对应（camelCase）。
//! 节点席位（`PredictionSlot`）只引用选项 id，同一选项可出现在多个节点（复制语义）。

use crate::scheme_store;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

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

#[tauri::command]
pub fn prediction_load(app: AppHandle) -> Result<PredictionData, String> {
    scheme_store::load(&app, "prediction.json", "赛事预测数据")
}

#[tauri::command]
pub fn prediction_save(app: AppHandle, data: PredictionData) -> Result<(), String> {
    scheme_store::save(&app, "prediction.json", "赛事预测数据", &data)
}
