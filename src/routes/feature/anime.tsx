"use no memo";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Spinner } from "@heroui/react";
import { Icon } from "@iconify/react";
import { createFileRoute } from "@tanstack/react-router";
import { tauriInvoke } from "../../lib/tauriInvoke";
import type {
  BangumiCalendarItem,
  BangumiWeekday,
} from "@components/bangumi/types";

export const Route = createFileRoute("/feature/anime")({
  component: AnimeRoute,
});

const hasTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** 展示用的星期列表（id 与 Bangumi 星期编号一致：1=周一 … 7=周日） */
const WEEKDAYS = [
  { id: 1, label: "周一" },
  { id: 2, label: "周二" },
  { id: 3, label: "周三" },
  { id: 4, label: "周四" },
  { id: 5, label: "周五" },
  { id: 6, label: "周六" },
  { id: 7, label: "周日" },
];

/** 今天对应的 Bangumi 星期编号（JS getDay 0=周日） */
function todayWeekday(): number {
  const day = new Date().getDay();
  return day === 0 ? 7 : day;
}

/** 在系统浏览器打开条目页 */
async function openItem(url: string) {
  if (hasTauri) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url).catch(() => {});
  } else {
    window.open(url, "_blank");
  }
}

function AnimeRoute() {
  const [weekdays, setWeekdays] = useState<BangumiWeekday[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(todayWeekday);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await tauriInvoke<BangumiWeekday[]>("bangumi_calendar", undefined, {
        defaultValue: [],
      });
      setWeekdays(data);
    } catch (err) {
      setWeekdays(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = weekdays?.find((w) => w.weekday === selected);

  /** 今天有放送的番剧数，用于在星期按钮上做小圆点提示 */
  const todayCount = useMemo(
    () => weekdays?.find((w) => w.weekday === todayWeekday())?.items.length ?? 0,
    [weekdays],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <header>
        <h1 className="m-0 text-xl font-extrabold tracking-tight text-[#66535a]">番剧</h1>
        <p className="m-0 mt-1 text-sm text-[#9b8a91]">
          每日放送时间表，数据来自
          Bangumi；点击卡片可在浏览器打开对应条目页。
        </p>
      </header>

      <div className="flex flex-wrap gap-2" role="group" aria-label="选择星期">
        {WEEKDAYS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={selected === id}
            className={
              selected === id
                ? "flex items-center gap-1.5 rounded-full border border-white/70 bg-white px-4 py-1.5 text-sm font-bold text-[#66535a] shadow-[0_2px_8px_rgb(133_77_96/14%)]"
                : "flex items-center gap-1.5 rounded-full border border-white/55 bg-white/45 px-4 py-1.5 text-sm font-semibold text-[#9b8a91] hover:text-[#66535a]"
            }
            onClick={() => setSelected(id)}
          >
            {id === todayWeekday() && (
              <span
                aria-hidden="true"
                className={
                  todayCount > 0
                    ? "h-1.5 w-1.5 rounded-full bg-[#d26d9a]"
                    : "h-1.5 w-1.5 rounded-full bg-[#e3d3da]"
                }
              />
            )}
            {label}
            {id === todayWeekday() && <span className="sr-only">（今天）</span>}
          </button>
        ))}
      </div>

      <div aria-live="polite" className="flex min-h-0 flex-1 flex-col">
        {loading && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-[#9b8a91]">
            <Spinner size="lg" color="accent" />
            正在获取时间表…
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <Icon
              icon="lucide:circle-off"
              width="36"
              height="36"
              aria-hidden="true"
              className="text-[#d8c7cf]"
            />
            <p className="m-0 max-w-sm text-sm break-all text-[#9b8a91]">
              获取时间表失败：{error}
            </p>
            <Button
              variant="primary"
              size="sm"
              onPress={() => void load()}
              className="rounded-full px-5 font-semibold"
            >
              <Icon icon="lucide:refresh-cw" width="16" height="16" aria-hidden="true" />
              重试
            </Button>
          </div>
        )}

        {!loading && !error && active && (
          <div className="min-h-0">
            {active.items.length === 0 ? (
              <p className="m-0 py-12 text-center text-sm text-[#9b8a91]">
                这一天没有放送的番剧
              </p>
            ) : (
              <ul
                aria-label={`${active.weekdayCn}放送列表`}
                className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4 p-0"
              >
                {active.items.map((item) => (
                  <AnimeCard key={item.id} item={item} />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** 单个番剧卡片：封面 + 中文名 + 原名 + 开播日期与评分 */
function AnimeCard({ item }: { item: BangumiCalendarItem }) {
  return (
    <li>
      <button
        type="button"
        aria-label={
          item.nameCn || item.name
            ? `打开番剧「${item.nameCn || item.name}」的条目页`
            : "打开番剧条目页"
        }
        onClick={() => void openItem(item.url)}
        className="group flex h-full w-full cursor-pointer flex-col gap-2 rounded-2xl border border-white/55 bg-white/65 p-2.5 text-left shadow-[0_4px_18px_rgb(133_77_96/12%)] transition hover:-translate-y-0.5 hover:border-[#f2bfd8] hover:shadow-[0_8px_24px_rgb(133_77_96/18%)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d26d9a] motion-reduce:transition-none"
      >
        <span className="relative block w-full overflow-hidden rounded-xl bg-[#f6e3e1] aspect-[3/4]">
          {item.image ? (
            <img
              src={item.image}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center">
              <Icon
                icon="lucide:image-off"
                width="26"
                height="26"
                aria-hidden="true"
                className="text-[#d8c7cf]"
              />
            </span>
          )}
          {item.score > 0 && (
            <span className="absolute top-1.5 right-1.5 flex items-center gap-0.5 rounded-full bg-white/92 px-1.5 py-0.5 text-[11px] font-bold text-[#d26d9a] shadow-[0_2px_6px_rgb(133_77_96/18%)]">
              <Icon icon="lucide:star" width="11" height="11" aria-hidden="true" />
              {item.score.toFixed(1)}
            </span>
          )}
        </span>
        <span className="line-clamp-2 text-sm leading-snug font-semibold text-[#66535a]">
          {item.nameCn || item.name || "未命名条目"}
        </span>
        {item.nameCn && item.name && (
          <span className="line-clamp-1 text-xs text-[#9b8a91]">{item.name}</span>
        )}
        <span className="mt-auto flex items-center gap-1 pt-0.5 text-xs text-[#9b8a91]">
          <Icon icon="lucide:calendar-days" width="13" height="13" aria-hidden="true" />
          {item.airDate || "未知日期"}
        </span>
      </button>
    </li>
  );
}
