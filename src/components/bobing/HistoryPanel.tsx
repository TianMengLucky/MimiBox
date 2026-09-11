import { useEffect, useRef, useState } from "react";
import { Button } from "@heroui/react";
import { Icon } from "@iconify/react";
import type { BobingHistoryEntry } from "./types";

function formatTime(time: number): string {
  return new Date(time).toLocaleString("zh-CN", { hour12: false });
}

/** 博饼历史面板：查看最近掷骰记录 / 清除（两步确认） */
export function HistoryPanel({
  entries,
  onClear,
}: {
  entries: BobingHistoryEntry[];
  onClear: () => void;
}) {
  const [confirmingClear, setConfirmingClear] = useState(false);
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  return (
    <section
      aria-label="博饼历史记录"
      className="flex flex-col gap-[clamp(4px,0.6cqw,10px)] rounded-2xl border border-white/60 bg-white/40 p-3"
    >
      <div className="flex items-center justify-between">
        <h2 className="bobing-heading m-0 font-bold text-[#66535a]">
          历史记录
          {entries.length > 0 && (
            <span className="bobing-row-meta ml-2 font-normal text-[#9b8a91]">
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
        <p className="bobing-history-list m-0 flex items-center justify-center rounded-2xl border border-dashed border-[#e7d5dd] bg-white/40 px-3 py-2 text-center text-[#9b8a91]">
          还没有掷骰记录
        </p>
      ) : (
        <ul className="bobing-history-list m-0 flex list-none flex-col gap-[clamp(2px,0.3cqw,6px)] overflow-y-auto p-0">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="bobing-row flex items-center gap-2 rounded-xl border border-white/60 bg-white/45 px-[0.7em] py-[0.3em]"
            >
              <Icon
                icon="lucide:dices"
                width="14"
                height="14"
                className="shrink-0 text-[#d26d9a]"
                aria-hidden="true"
              />
              <span className="shrink-0 font-semibold text-[#66535a]">{entry.rankName}</span>
              <span className="bobing-row-meta truncate text-[#9b8a91]">
                {entry.dice.join(" · ")}
              </span>
              <time className="bobing-row-meta ml-auto shrink-0 text-[#9b8a91]">
                {formatTime(entry.time)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
