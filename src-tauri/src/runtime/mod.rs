//! 宿主插件运行时：cordis 根上下文、命令注册表服务、宿主能力实现与
//! 已加载插件清单。网关命令（[`crate::gateway`]）经这里分发。

pub mod adapter;
pub mod host;
pub mod services;
pub mod vtable;

use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use cordis::Context;
use serde::Serialize;

use crate::loader::LoadedPlugin;

/// 宿主运行时（`app.manage`）：cordis 根上下文 + 已加载插件 + 插件目录。
pub struct MbRuntime {
    pub(crate) root: Context,
    pub(crate) host: Arc<host::HostImpl>,
    plugins: RwLock<Vec<LoadedPlugin>>,
    /// 插件扫描目录（按优先级：用户导入目录在前；mbplugin:// 协议按此查找）
    pub plugin_dirs: Vec<PathBuf>,
}

/// 已加载插件的对外信息（plugin_list 命令返回给前端）
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub id: String,
    pub title: String,
    pub emoji: String,
    pub description: String,
    /// 首页卡片分类：video（视频制作）/ fun（娱乐功能）
    pub category: String,
    /// 依赖的宿主服务（如 "account"）
    pub requires: Vec<String>,
    /// 是否来自用户导入目录（设置页据此展示「删除」）
    pub user_installed: bool,
    /// cordis Fiber 状态：Active / Pending / Failed …
    pub state: String,
    /// Pending 时缺失的服务名（如依赖的账号服务尚未就绪）
    pub missing: Vec<String>,
    pub entry: PluginEntryInfo,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginEntryInfo {
    pub backend: String,
    pub frontend: String,
}

impl MbRuntime {
    pub fn new(root: Context, host: Arc<host::HostImpl>, plugin_dirs: Vec<PathBuf>) -> Self {
        Self {
            root,
            host,
            plugins: RwLock::new(Vec::new()),
            plugin_dirs,
        }
    }

    /// 登记一个已加载插件（供 plugin_list 展示）
    pub(crate) fn add_plugin(&self, loaded: LoadedPlugin) {
        self.plugins.write().unwrap().push(loaded);
    }

    /// 已加载插件清单
    pub fn plugin_infos(&self) -> Vec<PluginInfo> {
        let plugins = self.plugins.read().unwrap();
        plugins
            .iter()
            .map(|loaded| PluginInfo {
                id: loaded.manifest.id.clone(),
                title: loaded.manifest.title.clone(),
                emoji: loaded.manifest.emoji.clone(),
                description: loaded.manifest.description.clone(),
                category: loaded.manifest.category.clone(),
                requires: loaded.manifest.requires.clone(),
                user_installed: loaded.user_installed,
                state: format!("{:?}", loaded.handle.state()),
                missing: loaded.handle.pending_missing(),
                entry: PluginEntryInfo {
                    backend: loaded.manifest.entry.backend.clone(),
                    frontend: loaded.manifest.entry.frontend.clone(),
                },
            })
            .collect()
    }
}
