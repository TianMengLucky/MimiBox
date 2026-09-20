import { useEffect, useState } from "react";
import { hasTauri, tauriInvoke } from "../../lib/tauriInvoke";
import type { DanmakuMessage, DanmakuSnapshot, DanmakuStatus } from "./types";

/** 弹幕事件名（Rust 端 bilibili_danmaku 广播） */
export const DANMAKU_MESSAGE_EVENT = "danmaku-message";
export const DANMAKU_STATUS_EVENT = "danmaku-status";

/** 列表保留上限：超出后裁掉最旧的弹幕 */
const FEED_LIMIT = 200;

/**
 * 订阅弹幕事件流：挂载时先用 `danmaku_snapshot` 补齐错过的状态与弹幕
 * （窗口晚于连接打开时也不丢内容），再监听 Rust 端广播的两个事件。
 */
export function useDanmakuFeed() {
  const [messages, setMessages] = useState<DanmakuMessage[]>([]);
  const [status, setStatus] = useState<DanmakuStatus | null>(null);

  useEffect(() => {
    if (!hasTauri) return;
    let disposed = false;
    const unlisteners: Array<() => void> = [];

    (async () => {
      try {
        const snapshot = await tauriInvoke<DanmakuSnapshot>("danmaku_snapshot");
        if (disposed) return;
        setMessages(snapshot.messages);
        setStatus(snapshot.status);
      } catch {
        // 连接尚未建立时快照为空是正常情况
      }

      const { listen } = await import("@tauri-apps/api/event");
      const offMessage = await listen<DanmakuMessage>(DANMAKU_MESSAGE_EVENT, (event) => {
        if (disposed) return;
        setMessages((prev) => {
          const next = [...prev, event.payload];
          return next.length > FEED_LIMIT ? next.slice(next.length - FEED_LIMIT) : next;
        });
      });
      const offStatus = await listen<DanmakuStatus>(DANMAKU_STATUS_EVENT, (event) => {
        if (disposed) return;
        setStatus(event.payload);
      });
      if (disposed) {
        offMessage();
        offStatus();
      } else {
        unlisteners.push(offMessage, offStatus);
      }
    })().catch((err) => console.error("订阅弹幕事件失败", err));

    return () => {
      disposed = true;
      unlisteners.forEach((off) => off());
    };
  }, []);

  return { messages, status };
}
