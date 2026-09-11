import { useEffect, useRef, useState } from "react";
import { Button, ScrollShadow } from "@heroui/react";
import { Icon } from "@iconify/react";
import type { LotteryHistoryEntry } from "./types";

function formatTime(time: number): string {
  return new Date(time).toLocaleString("zh-CN", { hour12: false });
}

/** 历史记录面板：查看最近抽奖记录 / 清除（两步确认） */
export function HistoryPanel({
  entries,
  onClear,
}: {
  entries: LotteryHistoryEntry[];
  onClear: () => void;
}) {
  const [confirmingClear, setConfirmingClear] = useState(false);
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  return (
    <section
      aria-label="抽奖历史记录"
      className="flex flex-col gap-2 min-[850px]:min-h-0 min-[850px]:flex-1"
    >
      <div className="flex items-center justify-between">
        <h2 className="m-0 text-sm font-bold text-[#66535a]">
          历史记录
          {entries.length > 0 && (
            <span className="ml-2 text-xs font-normal text-[#9b8a91]">
              最近 {entries.length} 条
            </span>
          )}
        </h2>
        {entries.length > 0 && (
          <Button
            size="sm"
            variant={confirmingClear ? "danger" : "ghost"}
            onPress={() => {
              window.clearTimeout(resetTimer.current);
              if (confirmingClear) {
                setConfirmingClear(false);
                onClear();
              } else {
                setConfirmingClear(true);
                resetTimer.current = window.setTimeout(() => setConfirmingClear(false), 3000);
              }
            }}
          >
            <Icon icon="lucide:eraser" width="14" height="14" aria-hidden="true" />
            {confirmingClear ? "确认清除？" : "清除记录"}
          </Button>
        )}
      </div>
      {entries.length === 0 ? (
        <p className="m-0 rounded-2xl border border-dashed border-[#e7d5dd] bg-white/40 px-3 py-4 text-center text-sm text-[#9b8a91]">
          还没有抽奖记录
        </p>
      ) : (
        <ScrollShadow className="max-h-56 pr-1 min-[850px]:max-h-none min-[850px]:min-h-0 min-[850px]:flex-1">
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center gap-2 rounded-xl border border-white/60 bg-white/45 px-3 py-1.5 text-sm"
              >
                <Icon icon="lucide:ticket" width="14" height="14" className="shrink-0 text-[#d26d9a]" aria-hidden="true" />
                <span className="shrink-0 font-semibold text-[#66535a]">{entry.prizeName}</span>
                <span className="truncate text-xs text-[#9b8a91]">{entry.schemeName}</span>
                <time className="ml-auto shrink-0 text-xs text-[#9b8a91]">{formatTime(entry.time)}</time>
              </li>
            ))}
          </ul>
        </ScrollShadow>
      )}
    </section>
  );
}
