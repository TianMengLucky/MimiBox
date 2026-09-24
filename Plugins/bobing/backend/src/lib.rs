//! 博饼插件后端：掷骰历史记录。
//!
//! 数据保存在应用数据目录 `bobing.json`（沿用插件化前的文件名，无数据迁移）。
//! 命令与插件化前完全同名，行为不变。彩头判定在前端完成。

use mimibox_plugin::{export_plugin, store, InvokeCtx, PluginBackend, Registry};
use serde::{Deserialize, Serialize};

/// 单次博饼历史记录
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BobingHistoryEntry {
    pub id: String,
    /// 六颗骰子的点数（1-6）
    pub dice: Vec<u8>,
    /// 彩头等级 id（前端规则判定结果）
    pub rank_id: String,
    pub rank_name: String,
    /// Unix 时间戳（毫秒）
    pub time: i64,
}

/// 保存到应用数据目录 bobing.json 的完整数据
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BobingData {
    #[serde(default)]
    pub history: Vec<BobingHistoryEntry>,
}

const FILE: &str = "bobing.json";
const LABEL: &str = "博饼数据";

struct BobingPlugin;

impl PluginBackend for BobingPlugin {
    fn register(&self, registry: &mut Registry) {
        registry.handle("bobing_load", |ctx: InvokeCtx, _args: ()| async move {
            store::load::<BobingData>(&*ctx.host, FILE, LABEL)
        });

        registry.handle("bobing_save", |ctx: InvokeCtx, data: BobingData| async move {
            store::save(&*ctx.host, FILE, LABEL, &data)
        });
    }
}

export_plugin!(BobingPlugin);
