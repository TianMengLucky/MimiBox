import { useCallback, useEffect, useState } from "react";
import { Box, Flex } from "@apvee/react-layout-kit";
import { Button } from "@heroui/react";
import { Icon } from "@iconify/react";
import { AnimatePresence, motion } from "motion/react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { createFileRoute } from "@tanstack/react-router";
import { unzipSync } from "fflate";
import { FileDropZone } from "@components/FileDropZone";
import { tauriInvoke } from "../lib/tauriInvoke";
import { errorMessage } from "@lib/errors";
import type { MbPluginManifest } from "../core/types";
import type { MbPluginMeta } from "../core/plugin-api";

export const Route = createFileRoute("/plugins")({
  component: PluginsRoute,
});

/** 插件状态徽标样式（Active 正常 / Pending 等待依赖 / Failed 失败） */
const STATE_META: Record<string, { label: string; className: string }> = {
  Active: { label: "已加载", className: "bg-pink-100 text-[#b0577f]" },
  Pending: { label: "等待依赖", className: "bg-amber-100 text-[#9a7b2e]" },
  Failed: { label: "加载失败", className: "bg-rose-100 text-[#c0444e]" },
};

/** zip 魔数（PK） */
function isZipBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

/** 解 zip 时跳过的构建缓存/系统垃圾（与宿主 EXCLUDE_NAMES 对应） */
const EXCLUDED_SEGMENTS = ["target", ".git", "node_modules", "__macosx", ".ds_store"];

/**
 * 前端 zip 导入前的 bundle 分析：在 WebView 里执行 bundle 的 CJS 工厂
 * （与 Tauri 在页面内 eval JS、插件运行时加载 bundle 同一方式，不引入
 * 额外 JS 运行时），读取 defineMbPlugin 定义中的 meta 自述，随导入请求
 * 头传给宿主。完整 .mip 包自带 plugin.json 清单（返回 null，宿主直接读
 * 清单）；解包失败 / 顶层执行失败 / 未声明 meta 时也返回 null，宿主回退
 * 为 banner id 派生清单。
 */
function analyzeFrontendBundle(bytes: Uint8Array): MbPluginMeta | null {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    return null;
  }
  if (files["plugin.json"]) return null;

  const jsNames = Object.keys(files).filter((name) => {
    if (name.endsWith("/") || !name.toLowerCase().endsWith(".js")) return false;
    return !name.split("/").some((seg) => EXCLUDED_SEGMENTS.includes(seg.toLowerCase()));
  });
  const entry =
    jsNames.find((name) => name === "index.js" || name.endsWith("/index.js")) ??
    (jsNames.length === 1 ? jsNames[0] : undefined);
  if (!entry) return null;

  const registered = window.__mb_plugins;
  const before = new Set(Object.keys(registered ?? {}));
  try {
    // 外部依赖以自返回 Proxy 桩替代（模块顶层只做定义，不执行渲染）；
    // "mb-host" 的 defineMbPlugin 透传定义对象，使 def 原样暴露
    const stub: unknown = new Proxy(function () {}, {
      get: () => stub,
      apply: () => stub,
      construct: () => ({}),
    });
    const requireStub = (name: string) =>
      name === "mb-host" ? { defineMbPlugin: (def: unknown) => def } : stub;
    const module = { exports: {} as Record<string, unknown> };
    new Function("require", "module", "exports", new TextDecoder().decode(files[entry]))(
      requireStub,
      module,
      module.exports,
    );
    const def = module.exports.default as { meta?: MbPluginMeta } | undefined;
    return def?.meta ?? null;
  } catch {
    return null;
  } finally {
    // 清理本次执行注册的工厂，避免导入失败时残留在全局表
    for (const key of Object.keys(window.__mb_plugins ?? {})) {
      if (!before.has(key)) delete window.__mb_plugins![key];
    }
  }
}

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

/** 导入结果（runImport 返回） */
interface ImportResult {
  title: string;
  /** 是否需要重启应用才生效（升级/替换已加载的插件） */
  needRestart: boolean;
}

/**
 * 插件管理页：独立页面集中管理插件的导入、加载与存放位置。把
 * .mip 插件包 / 后端 .dll / 前端 .zip 拖进窗口或点击选择即可导入
 * （文件字节上传宿主，zip 的 meta 自述在 WebView 内读取后随请求头
 * 传递），文件夹经系统目录对话框导入。导入新插件与删除插件均热
 * 加载/热卸载、即时生效；升级/替换同 id 插件需重启应用（dll 被占用）。
 */
function PluginsRoute() {
  const [plugins, setPlugins] = useState<MbPluginManifest[]>([]);
  const [dirInfo, setDirInfo] = useState<PluginDirInfo | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** 当前 notice 是否需要重启应用才能生效（决定是否展示「立即重启」按钮） */
  const [needsRestart, setNeedsRestart] = useState(false);
  /** 源码包导入时宿主推送的编译进度文本 */
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
    tauriInvoke<PluginDirInfo | null>("plugin_get_dir", undefined, { defaultValue: null })
      .then(setDirInfo)
      .catch(() => setDirInfo(null));
  }, []);

  useEffect(refresh, [refresh]);

  /** 执行单次导入 + 热加载（宿主按文件/目录类型自动分发），返回结果摘要 */
  const finishImport = useCallback(
    async (manifest: MbPluginManifest): Promise<ImportResult> => {
      // 热加载：新 id 插件即时生效；升级/替换已加载的插件需重启（dll 被占用）
      const reload = await tauriInvoke<ReloadOutcome>("plugin_reload", undefined, {
        defaultValue: { loaded: [], errors: [] },
      });
      refresh();
      return {
        title: manifest.title,
        needRestart: !reload.loaded.includes(manifest.id),
      };
    },
    [refresh],
  );

  const runImport = useCallback(
    async (path: string): Promise<ImportResult> => {
      const outcome = await tauriInvoke<{
        manifest: MbPluginManifest;
        installedPath: string;
      }>("plugin_import_file", { path });
      return finishImport(outcome.manifest);
    },
    [finishImport],
  );

  /** 拖入文件导入：HTML5 File 拿不到绝对路径，字节经 raw IPC 上传宿主，
   * 由宿主暂存为临时文件后走统一导入流程；zip 包先在 WebView 里执行
   * bundle 工厂读取 meta 自述，随请求头传给宿主（无需额外 JS 运行时） */
  const runImportDropped = useCallback(
    async (file: File): Promise<ImportResult> => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const headers: Record<string, string> = {
        "x-mb-file-name": encodeURIComponent(file.name),
      };
      if (isZipBytes(bytes)) {
        const meta = analyzeFrontendBundle(bytes);
        if (meta) {
          headers["x-mb-plugin-meta"] = encodeURIComponent(JSON.stringify(meta));
        }
      }
      const outcome = await invoke<{
        manifest: MbPluginManifest;
        installedPath: string;
      }>("plugin_import_dropped", bytes, { headers });
      return finishImport(outcome.manifest);
    },
    [finishImport],
  );

  /** 选择文件夹导入（文件统一走拖拽区的点击选择/拖入，经字节上传分析） */
  const importFolder = useCallback(async () => {
    setError("");
    setNotice(null);
    setNeedsRestart(false);
    const selection = await open({
      directory: true,
      multiple: false,
      title: "选择插件文件夹（内含 plugin.json）",
    });
    if (!selection) return;
    setBusy(true);
    try {
      const result = await runImport(selection);
      showNotice(
        result.needRestart
          ? `已导入「${result.title}」，重启应用后生效`
          : `已导入「${result.title}」，插件已生效`,
        result.needRestart,
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [runImport, showNotice]);

  /** 拖入文件导入：字节经宿主单一接口按类型识别分发（多文件逐个处理） */
  const importDropped = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setError("");
      setNotice(null);
      setNeedsRestart(false);
      setBusy(true);
      const failures: string[] = [];
      let lastTitle: string | null = null;
      let anyRestart = false;
      let okCount = 0;
      try {
        for (const file of files) {
          try {
            const result = await runImportDropped(file);
            lastTitle = result.title;
            anyRestart = anyRestart || result.needRestart;
            okCount += 1;
          } catch (err) {
            failures.push(`「${file.name}」导入失败：${errorMessage(err)}`);
          }
        }
        if (okCount === 1 && lastTitle) {
          showNotice(
            anyRestart ? `已导入「${lastTitle}」，重启应用后生效` : `已导入「${lastTitle}」，插件已生效`,
            anyRestart,
          );
        } else if (okCount > 1) {
          showNotice(`已导入 ${okCount} 个插件${anyRestart ? "，部分需重启应用后生效" : "，均已生效"}`, anyRestart);
        }
        if (failures.length > 0) {
          setError(failures.join("\n"));
        }
      } finally {
        setBusy(false);
      }
    },
    [runImportDropped, showNotice],
  );

  const remove = useCallback(
    async (id: string) => {
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
    },
    [refresh, showNotice],
  );

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
    <Flex direction="column" align="center" justify="center" mih="100dvh" px={96} py={80}>
      <Box
        asChild
        className="page-in rounded-3xl border border-white/55 bg-white/60 shadow-[0_8px_30px_rgb(133_77_96/14%)] backdrop-blur-[16px] backdrop-saturate-[1.3] motion-reduce:bg-white/80 motion-reduce:backdrop-blur-none"
        $width="100%"
        $maxWidth={560}
        p={28}
      >
        <section aria-label="插件管理">
          <Flex align="center" justify="space-between" gap={12}>
            <Box $minWidth={0}>
              <h1 className="m-0 text-left text-lg font-bold text-[#513844]">插件管理</h1>
              <p className="m-0 mt-0.5 text-sm text-[#9b8a91]">
                导入、加载与管理第三方插件
              </p>
            </Box>
            {busy && (
              <span
                className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-[#b0577f]"
                aria-live="polite"
              >
                <Icon icon="lucide:loader-circle" width="14" height="14" className="animate-spin" aria-hidden="true" />
                {stage ?? "正在导入…"}
              </span>
            )}
          </Flex>

          {/* 拖拽导入区：拖入 / 点击选择插件文件；区内链接选择插件文件夹。
              类型由宿主单一文件接口自动识别分发 */}
          <Box mt={16}>
            <FileDropZone
              accept=".mip,.dll,.so,.dylib,.zip"
              multiple
              disabled={busy}
              icon="lucide:package-open"
              title="拖入插件文件即可导入"
              hint="支持 .mip 插件包、后端 .dll、前端 .zip，点击选择文件，或"
              onFiles={(files) => void importDropped(files)}
              folderAction={{ label: "导入插件文件夹", onPress: () => void importFolder() }}
            />
          </Box>

          {/* 导入 / 删除结果 */}
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
              <motion.pre
                key="error"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="m-0 whitespace-pre-wrap rounded-xl bg-rose-50/80 px-3 py-2 font-sans text-xs break-all text-[#c0444e]"
              >
                {error}
              </motion.pre>
            )}
          </AnimatePresence>

          {/* 已加载插件清单 */}
          <ul className="m-0 mt-2 flex list-none flex-col p-0" aria-label="已加载插件">
            {plugins.map((plugin) => {
              const meta = STATE_META[plugin.state] ?? {
                label: plugin.state,
                className: "bg-[#f3eef0] text-[#9b8a91]",
              };
              return (
                <li
                  key={plugin.id}
                  className="flex items-center gap-2 border-t border-white/60 py-2 text-sm first:border-t-0"
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
                      isDisabled={busy}
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
            <p className="m-0 border-t border-white/60 py-3 text-xs text-[#9b8a91]">
              暂无插件加载信息
            </p>
          )}

          {/* 插件存放位置 */}
          <div className="mt-2 flex flex-col gap-1.5 border-t border-white/60 pt-3">
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
        </section>
      </Box>
    </Flex>
  );
}
