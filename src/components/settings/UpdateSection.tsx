import { useCallback, useEffect, useRef, useState } from "react";
import { Button, ProgressBar } from "@heroui/react";
import { Icon } from "@iconify/react";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import type { Update } from "@tauri-apps/plugin-updater";

type Phase =
  | "idle" // 尚未检查
  | "checking" // 正在检查更新
  | "latest" // 已是最新版本
  | "available" // 发现新版本，待下载
  | "downloading" // 下载中
  | "restarting" // 下载完成，重启安装
  | "error"; // 出错

interface DownloadProgress {
  downloaded: number;
  total: number | null;
}

/** 把字节数格式化成易读的 MB/KB 文本 */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 「应用更新」设置区：检查更新 → 下载（带进度）→ 安装并重启。
 * 更新源与签名公钥配置在 src-tauri/tauri.conf.json 的 plugins.updater；
 * 当前版本已展示在标题栏品牌卡片，这里不再重复显示。
 */
export function UpdateSection() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const [update, setUpdate] = useState<Update | null>(null);
  const [progress, setProgress] = useState<DownloadProgress>({
    downloaded: 0,
    total: null,
  });
  const updateRef = useRef<Update | null>(null);
  const installedRef = useRef(false);

  // 离开页面时释放尚未使用的更新资源（Tauri Resource 需显式 close）
  useEffect(() => {
    return () => {
      const pending = updateRef.current;
      if (pending && !installedRef.current) {
        void pending.close().catch(() => {});
      }
    };
  }, []);

  const handleCheck = useCallback(async () => {
    setPhase("checking");
    setMessage("");
    try {
      const found = await check();
      updateRef.current = found;
      installedRef.current = false;
      if (found) {
        setUpdate(found);
        setPhase("available");
      } else {
        setUpdate(null);
        setPhase("latest");
      }
    } catch (err) {
      setPhase("error");
      setMessage(errorMessage(err));
    }
  }, []);

  const handleDownload = useCallback(async () => {
    if (!update) return;
    setPhase("downloading");
    setMessage("");
    setProgress({ downloaded: 0, total: null });
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          setProgress({ downloaded: 0, total: event.data.contentLength ?? null });
        } else if (event.event === "Progress") {
          setProgress((prev) => ({
            ...prev,
            downloaded: prev.downloaded + event.data.chunkLength,
          }));
        }
      });
      installedRef.current = true;
      // Windows 上安装器启动后会自动退出应用；macOS/Linux 由这里重启
      setPhase("restarting");
      await relaunch();
    } catch (err) {
      setPhase("error");
      setMessage(errorMessage(err));
    }
  }, [update]);

  const busy = phase === "checking" || phase === "downloading" || phase === "restarting";
  const percent =
    progress.total && progress.total > 0
      ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
      : 0;

  return (
    <section aria-label="应用更新">
      <h2 className="m-0 text-sm font-bold text-[#66535a]">应用更新</h2>
      <div aria-live="polite" className="mt-1 divide-y divide-white/60">
        <div className="flex items-center justify-between gap-3 py-3">
          <span className="text-sm text-[#66535a]">软件更新</span>
          <Button
            variant="tertiary"
            size="sm"
            isDisabled={busy}
            isPending={phase === "checking"}
            onPress={() => void handleCheck()}
            className="rounded-full bg-white/45 font-semibold text-[#9b8a91] hover:text-[#66535a] focus-visible:text-[#66535a]"
          >
            检查更新
          </Button>
        </div>

        {phase === "latest" && (
          <p className="m-0 flex items-center gap-1.5 py-3 text-sm text-[#9b8a91]">
            <Icon icon="lucide:circle-check" width="16" height="16" aria-hidden="true" />
            已是最新版本
          </p>
        )}

        {phase === "available" && update && (
          <div className="flex flex-col gap-2.5 py-3">
            <p className="m-0 flex items-center gap-1.5 text-sm font-semibold text-[#66535a]">
              <Icon icon="lucide:party-popper" width="16" height="16" aria-hidden="true" />
              发现新版本 v{update.version}
            </p>
            {update.body?.trim() && (
              <div className="max-h-40 overflow-y-auto rounded-2xl bg-white/60 px-4 py-3 text-xs whitespace-pre-line text-[#66535a]">
                {update.body.trim()}
              </div>
            )}
            <Button
              variant="primary"
              size="sm"
              onPress={() => void handleDownload()}
              className="self-start rounded-full px-5 font-semibold"
            >
              <Icon icon="lucide:download" width="16" height="16" aria-hidden="true" />
              下载并安装
            </Button>
          </div>
        )}

        {phase === "downloading" && (
          <div className="py-3">
            <ProgressBar
              aria-label="下载进度"
              size="sm"
              color="accent"
              value={percent}
              maxValue={100}
              isIndeterminate={!progress.total}
              valueLabel={
                progress.total
                  ? `${formatBytes(progress.downloaded)} / ${formatBytes(progress.total)}`
                  : undefined
              }
            />
          </div>
        )}

        {phase === "restarting" && (
          <p className="m-0 flex items-center gap-1.5 py-3 text-sm text-[#9b8a91]">
            <Icon icon="lucide:loader-circle" width="16" height="16" aria-hidden="true" />
            下载完成，正在重启应用…
          </p>
        )}

        {phase === "error" && (
          <p className="m-0 py-3 text-xs break-all text-[#c0444e]">
            更新失败：{message || "未知错误"}
          </p>
        )}
      </div>
    </section>
  );
}
