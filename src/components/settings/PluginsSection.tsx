import { useCallback, useEffect, useState } from "react";
import { Button } from "@heroui/react";
import { Icon } from "@iconify/react";
import { AnimatePresence, motion } from "motion/react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { tauriInvoke } from "../../lib/tauriInvoke";
import { errorMessage } from "@lib/errors";
import type { MbPluginManifest } from "../../core/types";

/** 插件状态徽标样式（Active 正常 / Pending 等待依赖 / Failed 失败） */
const STATE_META: Record<string, { label: string; className: string }> = {
  Active: { label: "已加载", className: "bg-pink-100 text-[#b0577f]" },
  Pending: { label: "等待依赖", className: "bg-amber-100 text-[#9a7b2e]" },
  Failed: { label: "加载失败", className: "bg-rose-100 text-[#c0444e]" },
};

/** 插件目录信息（plugin_get_dir 返回） */
interface PluginDirInfo {
  current: string;
  customDir: string | null;
  defaultDir: string;
  isCustom: boolean;
}

/** 热加载结果（plugin_reload 返回） */
interface ReloadOutcome {
  loaded: string[];
  errors: string[];
}

/**
 * 「插件管理」设置区：展示已加载插件清单，支持从文件夹或 .mip 插件包
 * （zip 格式）导入第三方插件到用户插件目录；可自定义插件存放位置
 * （切换时自动迁移已导入插件）。导入新插件与删除插件均热加载/热卸载、
 * 即时生效；升级/替换同 id 插件需重启应用（dll 被占用）。
 */
export function PluginsSection() {
  const [plugins, setPlugins] = useState<MbPluginManifest[]>([]);
  const [dirInfo, setDirInfo] = useState<PluginDirInfo | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** 当前 notice 是否需要重启应用才能生效（决定是否展示「立即重启」按钮） */
  const [needsRestart, setNeedsRestart] = useState(false);
  /** 源码包导入时宿主推送的编译进度文本 */
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  /** 清除提示并记录新提示（restart=false 时不展示重启按钮） */
  const showNotice = useCallback((text: string, restart: boolean) => {
    setNotice(text);
    setNeedsRestart(restart);
  }, []);

  // 源码包导入时的现场编译可能耗时较长：展示宿主推送的进度文本
  useEffect(() => {
    if (!busy) {
      setStage(null);
      return;
    }
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen<string>("import-progress", (event) => {
      if (!cancelled) setStage(event.payload);
    }).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [busy]);

  const refresh = useCallback(() => {
    tauriInvoke<MbPluginManifest[]>("plugin_list", undefined, { defaultValue: [] })
      .then(setPlugins)
      .catch(() => setPlugins([]));
    tauriInvoke<PluginDirInfo>("plugin_get_dir")
      .then(setDirInfo)
      .catch(() => setDirInfo(null));
  }, []);

  useEffect(refresh, [refresh]);

  const importFrom = useCallback(
    async (kind: "folder" | "mip") => {
      setError("");
      setNotice(null);
      setNeedsRestart(false);
      const selection =
        kind === "folder"
          ? await open({
              directory: true,
              multiple: false,
              title: "选择插件文件夹（内含 plugin.json）",
            })
          : await open({
              multiple: false,
              title: "选择 MimiBox 插件包",
              filters: [
                { name: "MimiBox 插件包", extensions: ["mip"] },
                { name: "所有文件", extensions: ["*"] },
              ],
            });
      if (!selection) return;
      setBusy(true);
      try {
        const manifest = await tauriInvoke<{
          manifest: MbPluginManifest;
          installedPath: string;
        }>(kind === "folder" ? "plugin_import_folder" : "plugin_import_mip", {
          path: selection,
        });
        // 热加载：新 id 插件即时生效；升级/替换已加载的插件需重启（dll 被占用）
        const reload = await tauriInvoke<ReloadOutcome>("plugin_reload", undefined, {
          defaultValue: { loaded: [], errors: [] },
        });
        refresh();
        if (reload.loaded.includes(manifest.manifest.id)) {
          showNotice(`已导入「${manifest.manifest.title}」，插件已生效`, false);
        } else {
          showNotice(`已导入「${manifest.manifest.title}」，重启应用后生效`, true);
        }
        if (reload.errors.length > 0) {
          setError(reload.errors.join("\n"));
        }
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [refresh, showNotice],
  );

  const remove = useCallback(async (id: string) => {
    setError("");
    setNotice(null);
    setNeedsRestart(false);
    try {
      await tauriInvoke("plugin_remove", { id });
      refresh();
      showNotice(`已删除「${id}」，插件已停止`, false);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [refresh, showNotice]);

  /** 更改插件存放位置：选择新目录后自动迁移已导入的插件 */
  const changeDir = useCallback(async () => {
    setError("");
    setNotice(null);
    setNeedsRestart(false);
    const selection = await open({
      directory: true,
      multiple: false,
      title: "选择插件存放位置",
      defaultPath: dirInfo?.current,
    });
    if (!selection) return;
    setBusy(true);
    try {
      const info = await tauriInvoke<PluginDirInfo>("plugin_set_dir", {
        path: selection,
      });
      setDirInfo(info);
      showNotice("插件目录已更新，重启应用后生效", true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [dirInfo, showNotice]);

  /** 恢复默认插件目录（应用数据目录 plugins/） */
  const resetDir = useCallback(async () => {
    setError("");
    setNotice(null);
    setNeedsRestart(false);
    setBusy(true);
    try {
      const info = await tauriInvoke<PluginDirInfo>("plugin_set_dir", {
        path: null,
      });
      setDirInfo(info);
      showNotice("已恢复默认插件目录，重启应用后生效", true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [showNotice]);

  return (
    <section aria-label="插件管理">
      <h2 className="m-0 text-sm font-bold text-[#66535a]">插件</h2>
      <div aria-live="polite" className="mt-1 divide-y divide-white/60">
        {/* 插件存放位置 */}
        <div className="flex flex-col gap-1.5 py-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-[#66535a]">插件存放位置</span>
            <div className="flex items-center gap-2">
              {dirInfo?.isCustom && (
                <Button
                  variant="tertiary"
                  size="sm"
                  isDisabled={busy}
                  onPress={() => void resetDir()}
                  className="rounded-full bg-white/45 font-semibold text-[#9b8a91] hover:text-[#66535a] focus-visible:text-[#66535a]"
                >
                  恢复默认
                </Button>
              )}
              <Button
                variant="tertiary"
                size="sm"
                isDisabled={busy}
                onPress={() => void changeDir()}
                className="rounded-full bg-white/45 font-semibold text-[#9b8a91] hover:text-[#66535a] focus-visible:text-[#66535a]"
              >
                <Icon icon="lucide:folder-pen" width="14" height="14" aria-hidden="true" />
                更改位置
              </Button>
            </div>
          </div>
          {dirInfo && (
            <p
              className="m-0 truncate rounded-xl bg-white/50 px-3 py-2 font-mono text-xs text-[#9b8a91]"
              title={dirInfo.current}
            >
              {dirInfo.current}
              {dirInfo.isCustom && (
                <span className="ml-2 rounded-full bg-pink-100 px-2 py-0.5 font-sans text-[10px] font-bold text-[#b0577f]">
                  自定义
                </span>
              )}
            </p>
          )}
        </div>

        {/* 导入入口 */}
        <div className="flex flex-wrap items-center justify-between gap-2 py-3">
          <span className="text-sm text-[#66535a]">导入插件</span>
          <div className="flex items-center gap-2">
            <Button
              variant="tertiary"
              size="sm"
              isDisabled={busy}
              onPress={() => void importFrom("folder")}
              className="rounded-full bg-white/45 font-semibold text-[#9b8a91] hover:text-[#66535a] focus-visible:text-[#66535a]"
            >
              <Icon icon="lucide:folder-open" width="14" height="14" aria-hidden="true" />
              文件夹
            </Button>
            <Button
              variant="tertiary"
              size="sm"
              isDisabled={busy}
              onPress={() => void importFrom("mip")}
              className="rounded-full bg-white/45 font-semibold text-[#9b8a91] hover:text-[#66535a] focus-visible:text-[#66535a]"
            >
              <Icon icon="lucide:file-archive" width="14" height="14" aria-hidden="true" />
              .mip 插件包
            </Button>
          </div>
        </div>

        {/* 导入 / 删除结果 */}
        {busy && (
          <p className="m-0 py-3 text-xs text-[#9b8a91]" aria-live="polite">
            {stage ?? "正在导入…"}
          </p>
        )}
        <AnimatePresence initial={false} mode="wait">
          {notice && (
            <motion.div
              key="notice"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="flex flex-col gap-2 py-3"
            >
              <p className="m-0 flex items-center gap-1.5 text-sm font-semibold text-[#66535a]">
                <Icon icon="lucide:circle-check" width="16" height="16" className="text-[#b0577f]" aria-hidden="true" />
                {notice}
              </p>
              {needsRestart && (
                <Button
                  variant="primary"
                  size="sm"
                  onPress={() => void relaunch()}
                  className="self-start rounded-full px-5 font-semibold"
                >
                  <Icon icon="lucide:rotate-ccw" width="14" height="14" aria-hidden="true" />
                  立即重启
                </Button>
              )}
            </motion.div>
          )}
          {error && (
            <motion.p
              key="error"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="m-0 py-3 text-xs break-all text-[#c0444e]"
            >
              操作失败：{error}
            </motion.p>
          )}
        </AnimatePresence>

        {/* 已加载插件清单 */}
        <ul className="m-0 flex list-none flex-col p-0" aria-label="已加载插件">
          {plugins.map((plugin) => {
            const meta = STATE_META[plugin.state] ?? {
              label: plugin.state,
              className: "bg-[#f3eef0] text-[#9b8a91]",
            };
            return (
              <li
                key={plugin.id}
                className="flex items-center gap-2 py-2 text-sm"
              >
                <span aria-hidden="true">{plugin.emoji || "🧩"}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-semibold text-[#66535a]">{plugin.title}</span>
                  <span className="ml-2 truncate text-xs text-[#9b8a91]">{plugin.id}</span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${meta.className}`}
                >
                  {meta.label}
                </span>
                {plugin.userInstalled && (
                  <Button
                    variant="tertiary"
                    size="sm"
                    isIconOnly
                    aria-label={`删除插件 ${plugin.title}`}
                    onPress={() => void remove(plugin.id)}
                    className="min-w-7 rounded-full bg-white/45 text-[#9b8a91] hover:text-[#c0444e] focus-visible:text-[#c0444e]"
                  >
                    <Icon icon="lucide:trash-2" width="14" height="14" aria-hidden="true" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        {plugins.length === 0 && (
          <p className="m-0 py-3 text-xs text-[#9b8a91]">暂无插件加载信息</p>
        )}
      </div>
    </section>
  );
}
