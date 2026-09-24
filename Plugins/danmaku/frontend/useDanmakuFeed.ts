import { useEffect, useState } from "react";
import { hasTauri } from "@lib/tauriInvoke";
import type { DanmakuMessage, DanmakuStatus } from "./types";
import type { DanmakuApi } from "./api";

/** 列表保留上限：超出后裁掉最旧的弹幕 */
const FEED_LIMIT = 200;

/**
 * 订阅弹幕事件流：挂载时先用 `danmaku_snapshot` 补齐错过的状态与弹幕
 * （窗口晚于连接打开时也不丢内容），再监听插件后端广播的两个事件。
 */
export function useDanmakuFeed(api: DanmakuApi) {
  const [messages, setMessages] = useState<DanmakuMessage[]>([]);
  const [status, setStatus] = useState<DanmakuStatus | null>(null);

  useEffect(() => {
    if (!hasTauri) return;
    let disposed = false;
    const unlisteners: Array<() => void> = [];

    (async () => {
      try {
        const snapshot = await api.snapshot();
        if (disposed) return;
        setMessages(snapshot.messages);
        setStatus(snapshot.status);
      } catch {
        // 连接尚未建立时快照为空是正常情况
      }

      const offMessage = await api.listenMessage((message) => {
        if (disposed) return;
        setMessages((prev) => {
          const next = [...prev, message];
          return next.length > FEED_LIMIT ? next.slice(next.length - FEED_LIMIT) : next;
        });
      });
      const offStatus = await api.listenStatus((nextStatus) => {
        if (disposed) return;
        setStatus(nextStatus);
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
  }, [api]);

  return { messages, status };
}
