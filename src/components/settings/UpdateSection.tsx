import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, type MotionProps } from "motion/react";
import { Button, ProgressBar } from "@heroui/react";
import { Icon } from "@iconify/react";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import type { Update } from "@tauri-apps/plugin-updater";
import { errorMessage } from "../../lib/errors";
import { formatBytes } from "../../lib/format";

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

/** 各阶段内容块共用的过渡：旧块淡出后新块从上方落下淡入（AnimatePresence mode="wait"）。
    位移只用 -Y 方向：占满一屏的卡片底部不容许短暂溢出触发滚动条（见 style/motion.css 说明） */
const phaseTransition: MotionProps = {
  initial: { opacity: 0, y: -8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.18, ease: "easeOut" },
};

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

        <AnimatePresence initial={false} mode="wait">
          {phase === "latest" && (
            <motion.p
              key="latest"
              {...phaseTransition}
              className="m-0 flex items-center gap-1.5 py-3 text-sm text-[#9b8a91]"
            >
              <motion.span
                className="flex"
                initial={{ scale: 0, rotate: -90 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 420, damping: 16 }}
              >
                <Icon
                  icon="lucide:circle-check"
                  width="16"
                  height="16"
                  aria-hidden="true"
                />
              </motion.span>
              已是最新版本
            </motion.p>
          )}

          {phase === "available" && update && (
            <motion.div
              key="available"
              {...phaseTransition}
              className="flex flex-col gap-2.5 py-3"
            >
              <p className="m-0 flex items-center gap-1.5 text-sm font-semibold text-[#66535a]">
                <motion.span
                  className="flex"
                  initial={{ scale: 0, y: -8 }}
                  animate={{ scale: 1, y: 0 }}
                  transition={{ type: "spring", stiffness: 380, damping: 12 }}
                >
                  <Icon
                    icon="lucide:party-popper"
                    width="16"
                    height="16"
                    aria-hidden="true"
                  />
                </motion.span>
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
            </motion.div>
          )}

          {phase === "downloading" && (
            <motion.div key="downloading" {...phaseTransition} className="py-3">
              <ProgressBar
                aria-label="下载进度"
                size="sm"
                color="accent"
                value={percent}
                maxValue={100}
                isIndeterminate={!progress.total}
                valueLabel={
                  progress.total
                    ? `${percent}% · ${formatBytes(progress.downloaded)} / ${formatBytes(progress.total)}`
                    : formatBytes(progress.downloaded)
                }
              />
            </motion.div>
          )}

          {phase === "restarting" && (
            <motion.p
              key="restarting"
              {...phaseTransition}
              className="m-0 flex items-center gap-1.5 py-3 text-sm text-[#9b8a91]"
            >
              <Icon
                icon="lucide:loader-circle"
                width="16"
                height="16"
                aria-hidden="true"
                className="animate-spin motion-reduce:animate-none"
              />
              下载完成，正在重启应用…
            </motion.p>
          )}

          {phase === "error" && (
            <motion.p
              key="error"
              {...phaseTransition}
              className="m-0 py-3 text-xs break-all text-[#c0444e]"
            >
              更新失败：{message || "未知错误"}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
