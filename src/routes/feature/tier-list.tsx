import { useCallback, useEffect, useState } from "react";
import { Button } from "@heroui/react";
import { Icon } from "@iconify/react";
import { createFileRoute } from "@tanstack/react-router";
import { SchemeBar } from "@components/SchemeBar";
import { fileToCompressedImage } from "@components/image";
import { exportTierListImage } from "@components/tierlist/export";
import { PoolPanel } from "@components/tierlist/PoolPanel";
import { loadTierListData, saveTierListData } from "@components/tierlist/store";
import { TierRow } from "@components/tierlist/TierRow";
import { DEFAULT_TIERS, MAX_ITEMS } from "@components/tierlist/types";
import type {
  Tier,
  TierItem,
  TierListData,
  TierListScheme,
} from "@components/tierlist/types";
import type { DragSource } from "@components/tierlist/dnd";

export const Route = createFileRoute("/feature/tier-list")({
  component: TierListRoute,
});

const makeDefaultTiers = (): Tier[] =>
  DEFAULT_TIERS.map((def) => ({
    id: crypto.randomUUID(),
    name: def.name,
    color: def.color,
    items: [],
  }));

const makeScheme = (name: string): TierListScheme => ({
  id: crypto.randomUUID(),
  name,
  tiers: makeDefaultTiers(),
  pool: [],
});

/** 把任意方案的梯队规整为固定五个（旧数据里多余的条目并入“拉”行） */
const fixedTiers = (scheme: TierListScheme): Tier[] =>
  DEFAULT_TIERS.map((def, index) => ({
    id: scheme.tiers[index]?.id ?? crypto.randomUUID(),
    name: def.name,
    color: def.color,
    items: [
      ...(scheme.tiers[index]?.items ?? []),
      ...scheme.tiers.slice(DEFAULT_TIERS.length).flatMap((tier) => tier.items),
    ],
  }));

/** 保证数据可用：至少一个方案，且活动方案指向存在的方案；梯队固定不可变 */
function normalize(data: TierListData): TierListData {
  if (data.schemes.length === 0) {
    const scheme = makeScheme("默认方案");
    return { schemes: [scheme], activeSchemeId: scheme.id };
  }
  const schemes = data.schemes.map((scheme) => ({ ...scheme, tiers: fixedTiers(scheme) }));
  if (!schemes.some((s) => s.id === data.activeSchemeId)) {
    return { schemes, activeSchemeId: schemes[0].id };
  }
  return { ...data, schemes };
}

function TierListRoute() {
  const [data, setData] = useState<TierListData | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadTierListData().then((loaded) => {
      if (!cancelled) setData(normalize(loaded));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** 统一的数据更新入口：改内存的同时整体写盘 */
  const update = useCallback((fn: (prev: TierListData) => TierListData) => {
    setData((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      saveTierListData(next).catch((err) => console.error("保存排名数据失败", err));
      return next;
    });
  }, []);

  const activeScheme = data
    ? (data.schemes.find((s) => s.id === data.activeSchemeId) ?? data.schemes[0])
    : undefined;

  /** 修改当前方案的统一入口 */
  const mutateScheme = useCallback(
    (fn: (scheme: TierListScheme) => TierListScheme) => {
      update((prev) => ({
        ...prev,
        schemes: prev.schemes.map((s) => (s.id === prev.activeSchemeId ? fn(s) : s)),
      }));
    },
    [update],
  );

  const totalCount = activeScheme
    ? activeScheme.pool.length +
      activeScheme.tiers.reduce((sum, tier) => sum + tier.items.length, 0)
    : 0;
  const canAdd = totalCount < MAX_ITEMS;

  /** 把条目从来源（"pool" 或梯队 id）移动到目标 */
  const moveItem = useCallback(
    (source: DragSource, target: string) => {
      if (source.from === target) return;
      mutateScheme((scheme) => {
        let moved: TierItem | undefined;
        const tiers = scheme.tiers.map((tier) => {
          if (tier.id !== source.from) return tier;
          const found = tier.items.find((item) => item.id === source.id);
          if (found) moved = found;
          return { ...tier, items: tier.items.filter((item) => item.id !== source.id) };
        });
        let pool = scheme.pool;
        if (source.from === "pool") {
          const found = pool.find((item) => item.id === source.id);
          if (found) moved = found;
          pool = pool.filter((item) => item.id !== source.id);
        }
        const item = moved;
        if (!item) return scheme;
        if (target === "pool") {
          return { ...scheme, tiers, pool: [...pool, item] };
        }
        return {
          ...scheme,
          pool,
          tiers: tiers.map((tier) =>
            tier.id === target ? { ...tier, items: [...tier.items, item] } : tier,
          ),
        };
      });
    },
    [mutateScheme],
  );

  /** 彻底删除一个条目 */
  const removeItem = useCallback(
    (source: DragSource) => {
      mutateScheme((scheme) => ({
        ...scheme,
        pool:
          source.from === "pool"
            ? scheme.pool.filter((item) => item.id !== source.id)
            : scheme.pool,
        tiers: scheme.tiers.map((tier) =>
          tier.id === source.from
            ? { ...tier, items: tier.items.filter((item) => item.id !== source.id) }
            : tier,
        ),
      }));
    },
    [mutateScheme],
  );

  /** 拖放 / 多选添加图片到待排池：文件名（去扩展名）作为图片名 */
  const addFiles = async (files: File[]) => {
    if (!activeScheme) return;
    const images = files.filter((file) => file.type.startsWith("image/"));
    const notes: string[] = [];
    const skipped = files.length - images.length;
    if (skipped > 0) notes.push(`已忽略 ${skipped} 个非图片文件`);
    const remaining = MAX_ITEMS - totalCount;
    if (images.length > remaining) notes.push(`已达上限，仅添加前 ${remaining} 个`);
    const usable = images.slice(0, Math.max(0, remaining));
    const results = await Promise.allSettled(
      usable.map(async (file) => ({
        id: crypto.randomUUID(),
        name: file.name.replace(/\.[^.]+$/, "") || "图片",
        image: await fileToCompressedImage(file),
      })),
    );
    const added = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const failed = usable.length - added.length;
    if (failed > 0) notes.push(`${failed} 个图片处理失败`);
    if (added.length > 0) {
      mutateScheme((scheme) => ({ ...scheme, pool: [...scheme.pool, ...added] }));
    }
    setNotice(notes.length > 0 ? notes.join("，") : null);
  };

  const handleExport = async () => {
    if (!activeScheme || exporting || totalCount === 0) return;
    setExporting(true);
    setExportNotice(null);
    try {
      const path = await exportTierListImage(activeScheme);
      setExportNotice(`已保存到 ${path}`);
    } catch (err) {
      console.error("导出排名图失败", err);
      setExportNotice("导出失败，请重试");
    } finally {
      setExporting(false);
    }
  };

  if (!data || !activeScheme) {
    return null;
  }

  return (
    <div className="flex flex-1 flex-col gap-2.5">
      <header className="flex flex-wrap items-baseline gap-x-3">
        <h1 className="m-0 text-lg font-extrabold tracking-tight text-[#66535a]">夯到拉</h1>
        <p className="m-0 hidden text-sm text-[#9b8a91] min-[560px]:inline">
          把图片拖进梯队排出位次，支持多方案保存与导出排名图。
        </p>
      </header>

      <SchemeBar
        schemes={data.schemes}
        activeId={activeScheme.id}
        createLabel="新建方案（复制当前梯队）"
        onSelect={(id) => update((prev) => ({ ...prev, activeSchemeId: id }))}
        onCreate={() => {
          // 新建方案 = 复制当前梯队与待排池（另存为），图片一并带入
          const tiers = activeScheme.tiers.map((tier) => ({
            ...tier,
            id: crypto.randomUUID(),
            items: tier.items.map((item) => ({ ...item, id: crypto.randomUUID() })),
          }));
          const pool = activeScheme.pool.map((item) => ({
            ...item,
            id: crypto.randomUUID(),
          }));
          update((prev) => {
            const scheme: TierListScheme = {
              id: crypto.randomUUID(),
              name: `方案 ${prev.schemes.length + 1}`,
              tiers,
              pool,
            };
            return { ...prev, schemes: [...prev.schemes, scheme], activeSchemeId: scheme.id };
          });
        }}
        onDelete={() => {
          update((prev) => {
            const rest = prev.schemes.filter((s) => s.id !== prev.activeSchemeId);
            if (rest.length === 0) {
              const scheme = makeScheme("默认方案");
              return { ...prev, schemes: [scheme], activeSchemeId: scheme.id };
            }
            return { ...prev, schemes: rest, activeSchemeId: rest[0].id };
          });
        }}
      />

      <section aria-label="梯队" className="flex flex-1 flex-col gap-1.5">
        <ul className="m-0 flex flex-1 list-none flex-col gap-1.5 p-0">
          {activeScheme.tiers.map((tier) => (
            <TierRow
              key={tier.id}
              tier={tier}
              onDropItem={(source) => moveItem(source, tier.id)}
              onReturnToPool={(source) => moveItem(source, "pool")}
            />
          ))}
        </ul>
      </section>

      <PoolPanel
        pool={activeScheme.pool}
        canAdd={canAdd}
        onAddFiles={(files) => void addFiles(files)}
        onMoveToPool={(source) => moveItem(source, "pool")}
        onRemove={(id) => removeItem({ from: "pool", id })}
      />

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Button
          isDisabled={exporting || totalCount === 0}
          onPress={() => void handleExport()}
          aria-label="把当前排名保存成一张图片"
        >
          <Icon icon="lucide:image-down" width="16" height="16" aria-hidden="true" />
          {exporting ? "正在生成…" : "保存排名图"}
        </Button>
        <p aria-live="polite" className="m-0 text-xs text-[#9b8a91]">
          {totalCount} 张图片 · {activeScheme.pool.length} 张待排 ·{" "}
          {totalCount - activeScheme.pool.length} 张已分级
        </p>
        <p
          aria-live="polite"
          className={`m-0 min-h-4 min-w-0 flex-1 break-all text-right text-xs ${
            notice ? "text-rose-500" : "text-[#9b8a91]"
          }`}
        >
          {notice ?? exportNotice}
        </p>
      </div>
    </div>
  );
}
