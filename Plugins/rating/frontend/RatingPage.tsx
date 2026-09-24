import { useCallback, useMemo, useState } from "react";
import { Button, ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { Icon } from "@iconify/react";
import { SchemeBar } from "@components/SchemeBar";
import { SchemeTransfer } from "@components/schemeTransfer/SchemeTransfer";
import { useSchemeData } from "@components/schemeStore";
import { ImportDialog } from "./ImportDialog";
import { RatingCard } from "./RatingCard";
import { createRatingStore } from "./store";
import type { RatingData, RatingScheme, RatingSort } from "./types";
import { MAX_ITEMS } from "./types";

/** 页面数据读写（index.tsx 里用插件上下文构造后传入） */
type RatingStore = ReturnType<typeof createRatingStore>;

const makeScheme = (name: string): RatingScheme => ({
  id: crypto.randomUUID(),
  name,
  items: [],
});

/** 排序方式与展示标签；默认 = 导入顺序，时间 = 最近添加在前，评分 = 高分在前（未评垫底） */
const SORT_OPTIONS: { key: RatingSort; label: string; icon: string; hint: string }[] = [
  { key: "default", label: "默认", icon: "lucide:list", hint: "按导入顺序" },
  { key: "time", label: "时间", icon: "lucide:clock-3", hint: "最近添加在前" },
  { key: "score", label: "评分", icon: "lucide:star", hint: "高分在前" },
];

export default function RatingPage({ store }: { store: RatingStore }) {
  const [sort, setSort] = useState<RatingSort>("default");
  const [importing, setImporting] = useState(false);

  const {
    data,
    activeScheme,
    mutateScheme,
    selectScheme,
    addScheme,
    deleteActiveScheme,
    importSchemes,
  } = useSchemeData<RatingData, RatingScheme>({
    load: store.load,
    save: store.save,
    logLabel: "保存评分数据失败",
    makeDefaultScheme: () => makeScheme("默认方案"),
  });

  const items = useMemo(() => activeScheme?.items ?? [], [activeScheme]);

  /** 展示顺序：sort 为 default 时直接用导入顺序；其余用稳定排序，同分保持原顺序 */
  const sortedItems = useMemo(() => {
    if (sort === "default") return items;
    const list = [...items];
    if (sort === "time") list.sort((a, b) => b.createdAt - a.createdAt);
    if (sort === "score") {
      list.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
    }
    return list;
  }, [items, sort]);

  const ratedCount = items.filter((item) => item.score !== null).length;
  const average =
    ratedCount > 0
      ? items.reduce((sum, item) => sum + (item.score ?? 0), 0) / ratedCount
      : null;
  const remaining = MAX_ITEMS - items.length;

  /** 批量导入：每行一个名称，追加为未评分条目 */
  const importNames = useCallback(
    (names: string[]) => {
      if (names.length === 0) return;
      mutateScheme((scheme) => ({
        ...scheme,
        items: [
          ...scheme.items,
          ...names.map((name) => ({
            id: crypto.randomUUID(),
            name,
            score: null,
            createdAt: Date.now(),
          })),
        ],
      }));
    },
    [mutateScheme],
  );

  if (!data || !activeScheme) {
    return null;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      <header className="flex flex-wrap items-center gap-x-3">
        <h1 className="m-0 text-lg font-extrabold tracking-tight text-[#66535a]">评分</h1>
        <p className="m-0 hidden text-sm text-[#9b8a91] min-[560px]:inline">
          批量导入候选选项，逐张打 1-10 分，数据自动保存在本地。
        </p>
        <SchemeTransfer
          kind="rating"
          featureName="评分"
          className="ml-auto"
          schemes={data.schemes}
          onImport={importSchemes}
        />
      </header>

      <SchemeBar
        schemes={data.schemes}
        activeId={activeScheme.id}
        createLabel="新建空白方案"
        onSelect={selectScheme}
        onCreate={() =>
          addScheme(makeScheme(`方案 ${data.schemes.length + 1}`))
        }
        onDelete={deleteActiveScheme}
      />

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <ToggleButtonGroup
          aria-label="排序方式"
          selectionMode="single"
          selectedKeys={new Set([sort])}
          onSelectionChange={(keys) => {
            const key = [...keys][0];
            if (key === "default" || key === "time" || key === "score") {
              setSort(key);
            }
          }}
        >
          {SORT_OPTIONS.map(({ key, label, icon, hint }) => (
            <ToggleButton
              key={key}
              id={key}
              aria-label={`按${label}排序（${hint}）`}
              className="gap-1.5 rounded-full px-3.5 text-sm font-semibold"
            >
              <Icon icon={icon} width="14" height="14" aria-hidden="true" />
              {label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Button
          className="ml-auto"
          isDisabled={remaining <= 0}
          onPress={() => setImporting(true)}
        >
          <Icon icon="lucide:list-plus" width="16" height="16" aria-hidden="true" />
          批量导入
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[#e7d5dd] bg-white/40 px-6 py-10 text-center">
          <Icon
            icon="lucide:clipboard-list"
            width="28"
            height="28"
            className="text-[#d26d9a]"
            aria-hidden="true"
          />
          <p className="m-0 text-sm font-semibold text-[#66535a]">还没有可评分的选项</p>
          <p className="m-0 max-w-[320px] text-xs leading-relaxed text-[#9b8a91]">
            点击「批量导入」，每行粘贴一个选项名，导入后拖动卡片上的滑杆打分。
          </p>
          <Button className="mt-1.5" onPress={() => setImporting(true)}>
            <Icon icon="lucide:list-plus" width="16" height="16" aria-hidden="true" />
            批量导入
          </Button>
        </div>
      ) : (
        <section
          aria-label="评分卡片"
          className="min-h-0 flex-1 overflow-y-auto pr-1"
        >
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2.5 p-0">
            {sortedItems.map((item) => (
              <li key={item.id} className="min-w-0">
                <RatingCard
                  item={item}
                  onRename={(name) =>
                    mutateScheme((scheme) => ({
                      ...scheme,
                      items: scheme.items.map((it) =>
                        it.id === item.id ? { ...it, name } : it,
                      ),
                    }))
                  }
                  onScore={(score) =>
                    mutateScheme((scheme) => ({
                      ...scheme,
                      items: scheme.items.map((it) =>
                        it.id === item.id ? { ...it, score } : it,
                      ),
                    }))
                  }
                  onRemove={() =>
                    mutateScheme((scheme) => ({
                      ...scheme,
                      items: scheme.items.filter((it) => it.id !== item.id),
                    }))
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <p aria-live="polite" className="m-0 text-xs text-[#9b8a91]">
        {items.length} 个选项 · {ratedCount} 个已评分
        {average !== null ? ` · 平均 ${average.toFixed(1)} 分` : ""}
        {items.length >= MAX_ITEMS ? " · 已达上限" : ""}
      </p>

      <ImportDialog
        isOpen={importing}
        remaining={remaining}
        onClose={() => setImporting(false)}
        onSubmit={importNames}
      />
    </div>
  );
}
