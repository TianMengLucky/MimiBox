import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { createFileRoute } from "@tanstack/react-router";
import { hasTauri } from "../lib/tauriInvoke";
import DanmakuItem from "@components/danmaku/DanmakuItem";
import { useDanmakuFeed } from "@components/danmaku/useDanmakuFeed";
import type { DanmakuStatus } from "@components/danmaku/types";

export const Route = createFileRoute("/danmaku")({
  component: DanmakuWindow,
});

/** 连接状态的展示文案与状态点颜色 */
const STATE_META: Record<
  DanmakuStatus["state"],
  { label: string; dot: string }
> = {
  connecting: { label: "连接中…", dot: "bg-[#f0b95e]" },
  connected: { label: "已连接", dot: "bg-[#52c41a]" },
  reconnecting: { label: "重连中…", dot: "bg-[#f0b95e]" },
  disconnected: { label: "未连接", dot: "bg-[#c4b3ba]" },
};

/** 判断列表是否贴底（贴底时新弹幕自动滚动） */
function isPinnedToBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 48;
}

/**
 * 弹幕姬独立窗口：无系统标题栏，自绘迷你标题栏（拖拽/最小化/关闭），
 * 主体为自动滚动的二次元风格弹幕列表。数据来自 Rust 端弹幕协议解析。
 */
function DanmakuWindow() {
  const { messages, status } = useDanmakuFeed();
  const listRef = useRef<HTMLUListElement>(null);
  const [pinned, setPinned] = useState(true);

  const state = status?.state ?? "disconnected";
  const meta = STATE_META[state];

  // 贴底时新弹幕到达自动滚到最新一条；用户上翻则暂停跟随
  useEffect(() => {
    const el = listRef.current;
    if (el && pinned) el.scrollTo({ top: el.scrollHeight });
  }, [messages, pinned]);

  const onScroll = () => {
    const el = listRef.current;
    if (el) setPinned(isPinnedToBottom(el));
  };

  const scrollToBottom = () => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setPinned(true);
  };

  const minimizeWindow = async () => {
    if (!hasTauri) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().minimize();
  };

  const closeWindow = async () => {
    if (!hasTauri) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  };

  return (
    // #root 只有 min-height 没有确定高度，这里必须用视口单位而非 h-full
    <div className="relative flex h-dvh flex-col bg-gradient-to-b from-[#fff5f8] via-[#fdeef5] to-[#fbe3ee]">
      {/* 自绘标题栏：整条可拖拽（点击子元素按钮时不会触发拖拽） */}
      <header
        data-tauri-drag-region
        className="flex h-11 shrink-0 items-center gap-2 border-b border-white/60 bg-white/50 pl-3.5 backdrop-blur-md"
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} aria-hidden="true" />
        <Icon
          icon="simple-icons:bilibili"
          width="17"
          height="17"
          aria-hidden="true"
          className="shrink-0 text-[#fb7299]"
        />
        <span className="min-w-0 flex-1 truncate text-xs font-bold text-[#66535a]">
          {status?.roomTitle ?? "弹幕姬"}
        </span>
        {state === "connected" && status?.viewers ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold text-[#9b8a91]">
            <Icon icon="lucide:eye" width="12" height="12" aria-hidden="true" />
            {formatViewers(status.viewers)}
          </span>
        ) : null}
        <span className="shrink-0 pr-1 text-[11px] font-semibold text-[#9b8a91]">{meta.label}</span>
        <button
          type="button"
          aria-label="最小化"
          title="最小化"
          onClick={() => void minimizeWindow()}
          className="danmaku-window-control"
        >
          <Icon icon="mdi:window-minimize" width="14" height="14" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="关闭"
          title="关闭"
          onClick={() => void closeWindow()}
          className="danmaku-window-control"
        >
          <Icon icon="mdi:window-close" width="15" height="15" aria-hidden="true" />
        </button>
      </header>

      {/* 弹幕列表：唯一可滚动的子区域，页面主体始终一屏完整呈现 */}
      <ul
        ref={listRef}
        onScroll={onScroll}
        aria-label="弹幕列表"
        aria-live="polite"
        className="m-0 flex min-h-0 flex-1 list-none flex-col gap-2 overflow-y-auto p-0 px-3.5 py-3"
      >
        {messages.map((message) => (
          <DanmakuItem key={message.id} message={message} />
        ))}
        {messages.length === 0 && <DanmakuEmptyState state={state} />}
      </ul>

      {!pinned && messages.length > 0 ? (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/70 bg-white/90 px-3.5 py-1.5 text-xs font-bold text-[#66535a] shadow-[0_4px_14px_rgb(133_77_96/18%)] backdrop-blur hover:text-[#fb7299]"
        >
          <Icon icon="lucide:chevron-down" width="13" height="13" aria-hidden="true" />
          回到底部
        </button>
      ) : null}
    </div>
  );
}

/** 空状态：按连接状态给出下一步指引 */
function DanmakuEmptyState({ state }: { state: DanmakuStatus["state"] }) {
  const hint =
    state === "disconnected"
      ? "还没有开始——回到主窗口的「弹幕直播姬」选择账号并连接。"
      : state === "connected"
        ? "已连接直播间，等待第一条弹幕飘来…"
        : "正在与弹幕服务器建立连接，请稍候…";
  return (
    <li className="pointer-events-none flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
      <Icon
        icon="lucide:message-circle-heart"
        width="40"
        height="40"
        aria-hidden="true"
        className="text-[#eebcd0]"
      />
      <p className="m-0 max-w-60 text-xs leading-5 text-[#9b8a91]">{hint}</p>
    </li>
  );
}

/** 人气值缩写：1.2 万 */
function formatViewers(count: number): string {
  return count >= 10000 ? `${(count / 10000).toFixed(1)} 万` : String(count);
}
