//! 抽奖插件后端：转盘方案、奖品与历史记录。
//!
//! 数据保存在应用数据目录 `lottery.json`（沿用插件化前的文件名，
//! 无数据迁移）。命令与插件化前完全同名，行为不变。

use mimibox_plugin::{export_plugin, store, InvokeCtx, PluginBackend, Registry};
use serde::{Deserialize, Serialize};

/// 转盘奖品：名称 + 可选图片（前端压缩后的 PNG data URL）
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LotteryPrize {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub image: Option<String>,
}

/// 抽奖方案：一组奖品，可新建/切换/删除
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LotteryScheme {
    pub id: String,
    pub name: String,
    pub prizes: Vec<LotteryPrize>,
}

/// 单条抽奖历史记录
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LotteryHistoryEntry {
    pub id: String,
    pub scheme_id: String,
    pub scheme_name: String,
    pub prize_id: String,
    pub prize_name: String,
    /// Unix 时间戳（毫秒）
    pub time: i64,
}

/// 保存到应用数据目录 lottery.json 的完整数据
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LotteryData {
    #[serde(default)]
    pub schemes: Vec<LotteryScheme>,
    #[serde(default)]
    pub active_scheme_id: Option<String>,
    #[serde(default)]
    pub history: Vec<LotteryHistoryEntry>,
}

const FILE: &str = "lottery.json";
const LABEL: &str = "抽奖数据";

struct LotteryPlugin;

impl PluginBackend for LotteryPlugin {
    fn register(&self, registry: &mut Registry) {
        registry.handle("lottery_load", |ctx: InvokeCtx, _args: ()| async move {
            store::load::<LotteryData>(&*ctx.host, FILE, LABEL)
        });

        registry.handle("lottery_save", |ctx: InvokeCtx, data: LotteryData| async move {
            store::save(&*ctx.host, FILE, LABEL, &data)
        });
    }
}

export_plugin!(LotteryPlugin);
