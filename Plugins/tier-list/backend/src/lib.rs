//! 夯到拉插件后端：梯队排名方案与图片导出。
//!
//! 数据保存在应用数据目录 `tierlist.json`（沿用插件化前的文件名，无数据迁移）。
//! 命令与插件化前完全同名，行为不变。

use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use mimibox_plugin::{export_plugin, store, InvokeCtx, PluginBackend, Registry};
use serde::{Deserialize, Serialize};

/// 排名条目：图片（前端压缩后的 PNG data URL）+ 可选名称
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TierItem {
    pub id: String,
    #[serde(default)]
    pub name: String,
    pub image: String,
}

/// 一个梯队：名称 + 底色 + 已归类的条目
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Tier {
    pub id: String,
    pub name: String,
    pub color: String,
    #[serde(default)]
    pub items: Vec<TierItem>,
}

/// 排名方案：梯队列表 + 待排图片池
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TierListScheme {
    pub id: String,
    pub name: String,
    pub tiers: Vec<Tier>,
    #[serde(default)]
    pub pool: Vec<TierItem>,
}

/// 保存到应用数据目录 tierlist.json 的完整数据
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TierListData {
    #[serde(default)]
    pub schemes: Vec<TierListScheme>,
    #[serde(default)]
    pub active_scheme_id: Option<String>,
}

const FILE: &str = "tierlist.json";
const LABEL: &str = "排名数据";

/// 导出图片入参：文件名（用于生成导出文件名）+ PNG data URL
#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ExportImageArgs {
    name: String,
    data_url: String,
}

/// 去掉文件名中的非法字符；清理后为空则用默认名
fn sanitize_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => ' ',
            other => other,
        })
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        "排名表".to_string()
    } else {
        trimmed.to_string()
    }
}

struct TierListPlugin;

impl PluginBackend for TierListPlugin {
    fn register(&self, registry: &mut Registry) {
        registry.handle("tierlist_load", |ctx: InvokeCtx, _args: ()| async move {
            store::load::<TierListData>(&*ctx.host, FILE, LABEL)
        });

        registry.handle("tierlist_save", |ctx: InvokeCtx, data: TierListData| async move {
            store::save(&*ctx.host, FILE, LABEL, &data)
        });

        // 把前端画好的排名图 PNG 写入数据目录 exports/ 并在资源管理器中定位
        registry.handle(
            "tierlist_export_image",
            |ctx: InvokeCtx, args: ExportImageArgs| async move {
                let exports_dir = ctx.host.data_dir()?.join("exports");
                fs::create_dir_all(&exports_dir)
                    .map_err(|e| format!("无法创建导出目录 {}: {e}", exports_dir.display()))?;

                let payload = args
                    .data_url
                    .strip_prefix("data:image/png;base64,")
                    .ok_or_else(|| "图片格式不正确，仅支持 PNG data URL".to_string())?;
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(payload)
                    .map_err(|e| format!("图片解码失败: {e}"))?;

                let stamp = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or_default();
                let file_name = format!("{}-{stamp}.png", sanitize_name(&args.name));
                let path = exports_dir.join(file_name);
                fs::write(&path, &bytes)
                    .map_err(|e| format!("无法写入排名图 {}: {e}", path.display()))?;

                // 定位失败不算导出失败，图片已经保存成功
                if let Err(e) = ctx.host.reveal_path(&path.to_string_lossy()) {
                    eprintln!("定位导出文件失败: {e}");
                }
                Ok(path.display().to_string())
            },
        );
    }
}

export_plugin!(TierListPlugin);
