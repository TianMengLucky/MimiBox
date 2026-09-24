import { Icon } from "@iconify/react";
import type { UploadZoneMain } from "./types";

/**
 * 投稿分区选择：一级分区 tab + 子分区下拉，两段式符合 B 站投稿习惯。
 * 受控组件，tid 即提交稿件的子分区 id。
 */
export function CategoryPicker({
  zones,
  mainTid,
  tid,
  disabled,
  onMainChange,
  onTidChange,
}: {
  zones: UploadZoneMain[];
  mainTid: number | null;
  tid: number | null;
  disabled?: boolean;
  onMainChange: (tid: number) => void;
  onTidChange: (tid: number) => void;
}) {
  const main = zones.find((zone) => zone.tid === mainTid) ?? zones[0];

  return (
    <div className="flex flex-col gap-2">
      <div
        role="group"
        aria-label="一级分区"
        className="flex flex-wrap gap-1.5"
      >
        {zones.map((zone) => {
          const active = zone.tid === main?.tid;
          return (
            <button
              key={zone.tid}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              className={
                active
                  ? "cursor-pointer rounded-full border border-white/70 bg-white px-3 py-1 text-xs font-bold text-[#66535a] shadow-[0_2px_8px_rgb(133_77_96/14%)]"
                  : "cursor-pointer rounded-full border border-white/55 bg-white/45 px-3 py-1 text-xs font-semibold text-[#9b8a91] transition-colors hover:text-[#66535a] disabled:cursor-default disabled:opacity-50"
              }
              onClick={() => {
                onMainChange(zone.tid);
                onTidChange(zone.children[0]?.tid ?? zone.tid);
              }}
            >
              {zone.name}
            </button>
          );
        })}
      </div>
      <label className="flex items-center gap-1.5 self-start rounded-full border border-white/55 bg-white/60 py-1.5 pl-3 pr-2">
        <Icon icon="lucide:layout-grid" width="14" height="14" aria-hidden="true" className="shrink-0 text-[#9b8a91]" />
        <span className="sr-only">选择子分区</span>
        <select
          value={tid ?? main?.children[0]?.tid ?? ""}
          disabled={disabled}
          onChange={(event) => onTidChange(Number(event.target.value))}
          className="cursor-pointer bg-transparent text-sm font-semibold text-[#66535a] outline-none disabled:cursor-default"
        >
          {main?.children.map((child) => (
            <option key={child.tid} value={child.tid}>
              {child.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
