//! 宿主插件运行时：cordis 根上下文、命令注册表服务、宿主能力实现与
//! 已加载插件清单。网关命令（[`crate::gateway`]）经这里分发。

pub mod adapter;
pub mod host;
pub mod services;
pub mod vtable;

use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use cordis::Context;
use serde::Serialize;

use crate::loader::LoadedPlugin;

/// 宿主运行时（`app.manage`）：cordis 根上下文 + 已加载插件 + 插件目录。
pub struct MbRuntime {
    pub(crate) root: Context,
    pub(crate) host: Arc<host::HostImpl>,
    plugins: RwLock<Vec<LoadedPlugin>>,
    /// 已停止插件的保底引用（持有 dll 句柄防运行中 FreeLibrary，直至进程退出）
    retired: RwLock<Vec<LoadedPlugin>>,
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
            retired: RwLock::new(Vec::new()),
            plugin_dirs,
        }
    }

    /// 登记一个已加载插件（供 plugin_list 展示）
    pub(crate) fn add_plugin(&self, loaded: LoadedPlugin) {
        self.plugins.write().unwrap().push(loaded);
    }

    /// 热加载新导入的插件：扫描目录并加载尚未加载的插件（已加载的跳过，
    /// Windows 下运行中的 dll 无法覆盖，升级同 id 插件仍需重启）。
    /// 返回（新加载的插件 id，失败摘要）。
    pub(crate) async fn reload_new(
        &self,
        dirs: &[PathBuf],
        user_dir: &Path,
    ) -> (Vec<String>, Vec<String>) {
        let loaded_ids: Vec<String> = {
            let plugins = self.plugins.read().unwrap();
            plugins.iter().map(|p| p.manifest.id.clone()).collect()
        };
        let (mut new_plugins, errors) =
            crate::loader::load_new(&self.root, dirs, user_dir, &loaded_ids).await;
        let mut ids = Vec::with_capacity(new_plugins.len());
        for item in new_plugins.drain(..) {
            ids.push(item.manifest.id.clone());
            self.plugins.write().unwrap().push(item);
        }
        (ids, errors)
    }

    /// 热卸载：终态处置插件 Fiber（dispose 过程执行清理 effect，从命令
    /// 注册表注销），并把实例移入 retired 列表——保住 dll 引用，避免
    /// 运行中 FreeLibrary。返回是否找到并停止了该插件。
    pub(crate) async fn stop_plugin(&self, id: &str) -> bool {
        let removed = {
            let mut plugins = self.plugins.write().unwrap();
            match plugins.iter().position(|p| p.manifest.id == id) {
                Some(index) => Some(plugins.remove(index)),
                None => None,
            }
        };
        let Some(item) = removed else {
            return false;
        };
        let _ = item.handle.dispose().await;
        self.retired.write().unwrap().push(item);
        true
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
