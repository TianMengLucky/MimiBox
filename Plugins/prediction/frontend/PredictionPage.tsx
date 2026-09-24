import { useCallback, useMemo, useState } from "react";
import { SchemeBar } from "@components/SchemeBar";
import { SchemeTransfer } from "@components/schemeTransfer/SchemeTransfer";
import { useSchemeData } from "@components/schemeStore";
import { fileToCompressedImage } from "@components/image";
import { BracketFlow } from "./BracketFlow";
import type { BracketActions } from "./BracketFlow";
import { EntryPool } from "./EntryPool";
import { createPredictionStore } from "./store";
import {
  MAX_ENTRIES,
  MAX_NODES_PER_ROUND,
  MAX_ROUNDS,
  SLOT_PER_NODE,
  emptySlot,
  makeNode,
  makeScheme,
} from "./types";
import type {
  PredictionData,
  PredictionEntry,
  PredictionScheme,
  PredictionSlot,
  SchemeBackground,
} from "./types";

/** 页面数据读写（index.tsx 里用插件上下文构造后传入） */
type PredictionStore = ReturnType<typeof createPredictionStore>;

/** 领域规整：席位引用的选项与连线引用的节点都还在（“至少一个方案”由公共规整负责） */
function normalize(data: PredictionData): PredictionData {
  const schemes = data.schemes.map((scheme) => {
    const known = new Set(scheme.entries.map((entry) => entry.id));
    const rounds = scheme.rounds.map((round) => ({
      ...round,
      nodes: round.nodes.map((node) => {
        // 席位固定为两个（旧数据多退少补），并清掉引用已删选项的席位
        const padded =
          node.slots.length === SLOT_PER_NODE
            ? node.slots
            : [
                ...node.slots.slice(0, SLOT_PER_NODE),
                ...Array.from(
                  { length: Math.max(0, SLOT_PER_NODE - node.slots.length) },
                  emptySlot,
                ),
              ];
        return {
          ...node,
          slots: padded.map((slot) =>
            slot.entryId && !known.has(slot.entryId) ? emptySlot() : slot,
          ),
        };
      }),
    }));
    // 丢弃端点不存在的连线，并按 source+target 去重
    const nodeIds = new Set(rounds.flatMap((round) => round.nodes.map((node) => node.id)));
    const seenPairs = new Set<string>();
    const links = (scheme.links ?? []).filter((link) => {
      if (!nodeIds.has(link.source) || !nodeIds.has(link.target)) return false;
      if (link.source === link.target) return false;
      const pair = `${link.source}->${link.target}`;
      if (seenPairs.has(pair)) return false;
      seenPairs.add(pair);
      return true;
    });
    // 只保留仍存在的节点坐标；背景缺省为默认样式
    const positions: PredictionScheme["positions"] = {};
    for (const [nodeId, point] of Object.entries(scheme.positions ?? {})) {
      if (nodeIds.has(nodeId) && point) positions[nodeId] = point;
    }
    const background: SchemeBackground = scheme.background ?? { color: "", image: null };
    return { ...scheme, rounds, links, positions, background };
  });
  return { ...data, schemes };
}

export default function PredictionPage({ store }: { store: PredictionStore }) {
  const [notice, setNotice] = useState<string | null>(null);

  const {
    data,
    activeScheme,
    mutateScheme,
    selectScheme,
    addScheme,
    deleteActiveScheme,
    importSchemes,
  } = useSchemeData<PredictionData, PredictionScheme>({
    load: store.load,
    save: store.save,
    logLabel: "保存赛事预测数据失败",
    normalize,
    makeDefaultScheme: () => makeScheme("默认方案"),
  });

  const entries = activeScheme?.entries ?? [];
  const rounds = activeScheme?.rounds ?? [];
  const entryById = useMemo(
    () => new Map(entries.map((entry) => [entry.id, entry])),
    [entries],
  );
  const canAddEntry = entries.length < MAX_ENTRIES;

  /* ---------- 选项操作 ---------- */

  /** 拖放 / 多选导入图片：一张图片一个选项，文件名（去扩展名）作为选项名 */
  const addFiles = async (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith("image/"));
    const notes: string[] = [];
    const skipped = files.length - images.length;
    if (skipped > 0) notes.push(`已忽略 ${skipped} 个非图片文件`);
    const remaining = MAX_ENTRIES - entries.length;
    if (images.length > remaining) notes.push(`已达上限，仅添加前 ${remaining} 个`);
    const usable = images.slice(0, Math.max(0, remaining));
    const results = await Promise.allSettled(
      usable.map(async (file) => ({
        id: crypto.randomUUID(),
        name: file.name.replace(/\.[^.]+$/, "") || "未命名",
        image: await fileToCompressedImage(file),
      })),
    );
    const added = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const failed = usable.length - added.length;
    if (failed > 0) notes.push(`${failed} 个图片处理失败`);
    if (added.length > 0) {
      mutateScheme((scheme) => ({ ...scheme, entries: [...scheme.entries, ...added] }));
    }
    setNotice(notes.length > 0 ? notes.join("，") : null);
  };

  const createEntry = () => {
    const entry: PredictionEntry = {
      id: crypto.randomUUID(),
      name: `选项 ${entries.length + 1}`,
      image: null,
    };
    mutateScheme((scheme) => ({ ...scheme, entries: [...scheme.entries, entry] }));
  };

  const renameEntry = (id: string, name: string) => {
    mutateScheme((scheme) => ({
      ...scheme,
      entries: scheme.entries.map((entry) =>
        entry.id === id ? { ...entry, name } : entry,
      ),
    }));
  };

  const setEntryImage = async (id: string, file: File) => {
    try {
      const image = await fileToCompressedImage(file);
      mutateScheme((scheme) => ({
        ...scheme,
        entries: scheme.entries.map((entry) =>
          entry.id === id ? { ...entry, image } : entry,
        ),
      }));
    } catch (err) {
      console.error("处理图片失败", err);
      setNotice("图片处理失败，请换一张试试");
    }
  };

  /** 删除选项：同时把它从所有节点席位上移除 */
  const removeEntry = (id: string) => {
    mutateScheme((scheme) => ({
      ...scheme,
      entries: scheme.entries.filter((entry) => entry.id !== id),
      rounds: scheme.rounds.map((round) => ({
        ...round,
        nodes: round.nodes.map((node) => ({
          ...node,
          slots: node.slots.map((slot) =>
            slot.entryId === id ? emptySlot() : slot,
          ),
        })),
      })),
    }));
  };

  /* ---------- 放置与席位操作 ---------- */

  const placeEntry = useCallback(
    (roundId: string, nodeId: string, slotIndex: number | null, entryId: string) => {
      // 提示前置：空位判断放在更新器外，避免在 setState 更新器里再触发 setState
      const node = rounds.find((r) => r.id === roundId)?.nodes.find((n) => n.id === nodeId);
      if (node && slotIndex === null && node.slots.every((slot) => slot.entryId)) {
        setNotice("两个席位都已占用，请拖到要替换的席位上");
        return;
      }
      mutateScheme((scheme) => {
        // 选项必须存在；放置 = 复制语义，来源不受影响
        if (!scheme.entries.some((entry) => entry.id === entryId)) return scheme;
        const rounds = scheme.rounds.map((round) => {
          if (round.id !== roundId) return round;
          return {
            ...round,
            nodes: round.nodes.map((node) => {
              if (node.id !== nodeId) return node;
              if (slotIndex !== null) {
                // 指定席位：直接放置/替换，比分一并清零
                return {
                  ...node,
                  slots: node.slots.map((slot, index) =>
                    index === slotIndex ? { entryId, score: "" } : slot,
                  ),
                };
              }
              // 未指定席位：放入第一个空位
              const freeIndex = node.slots.findIndex((slot) => !slot.entryId);
              if (freeIndex < 0) return node;
              return {
                ...node,
                slots: node.slots.map((slot, index) =>
                  index === freeIndex ? { entryId, score: "" } : slot,
                ),
              };
            }),
          };
        });
        return { ...scheme, rounds };
      });
    },
    [mutateScheme, rounds],
  );

  const patchSlots = useCallback(
    (roundId: string, nodeId: string, fn: (slots: PredictionSlot[]) => PredictionSlot[]) => {
      mutateScheme((scheme) => ({
        ...scheme,
        rounds: scheme.rounds.map((round) =>
          round.id !== roundId
            ? round
            : {
                ...round,
                nodes: round.nodes.map((node) =>
                  node.id !== nodeId ? node : { ...node, slots: fn(node.slots) },
                ),
              },
        ),
      }));
    },
    [mutateScheme],
  );

  const clearSlot = (roundId: string, nodeId: string, slotIndex: number) =>
    patchSlots(roundId, nodeId, (slots) =>
      slots.map((slot, index) => (index === slotIndex ? emptySlot() : slot)),
    );

  const changeScore = (roundId: string, nodeId: string, slotIndex: number, score: string) =>
    patchSlots(roundId, nodeId, (slots) =>
      slots.map((slot, index) => (index === slotIndex ? { ...slot, score } : slot)),
    );

  const setSlotImage = (roundId: string, nodeId: string, slotIndex: number, file: File) => {
    const slot = rounds
      .find((round) => round.id === roundId)
      ?.nodes.find((node) => node.id === nodeId)?.slots[slotIndex];
    if (slot?.entryId) void setEntryImage(slot.entryId, file);
  };

  /* ---------- 节点与分组操作 ---------- */

  const patchRounds = useCallback(
    (fn: (rounds: PredictionScheme["rounds"]) => PredictionScheme["rounds"]) => {
      mutateScheme((scheme) => ({ ...scheme, rounds: fn(scheme.rounds) }));
    },
    [mutateScheme],
  );

  const addRound = () =>
    patchRounds((rounds) =>
      rounds.length >= MAX_ROUNDS
        ? rounds
        : [
            ...rounds,
            {
              id: crypto.randomUUID(),
              name: `分组 ${rounds.length + 1}`,
              nodes: [makeNode("")],
            },
          ],
    );

  const renameRound = (roundId: string, name: string) =>
    patchRounds((rounds) =>
      rounds.map((round) => (round.id === roundId ? { ...round, name } : round)),
    );

  const addNode = (roundId: string) =>
    patchRounds((rounds) =>
      rounds.map((round) =>
        round.id !== roundId || round.nodes.length >= MAX_NODES_PER_ROUND
          ? round
          : { ...round, nodes: [...round.nodes, makeNode("")] },
      ),
    );

  const renameNode = (roundId: string, nodeId: string, title: string) =>
    patchRounds((rounds) =>
      rounds.map((round) =>
        round.id !== roundId
          ? round
          : {
              ...round,
              nodes: round.nodes.map((node) =>
                node.id === nodeId ? { ...node, title } : node,
              ),
            },
      ),
    );

  /** 删除节点时，一并清理与它相连的晋级线和手动坐标 */
  const deleteNode = (roundId: string, nodeId: string) =>
    mutateScheme((scheme) => {
      const positions = { ...scheme.positions };
      delete positions[nodeId];
      return {
        ...scheme,
        rounds: scheme.rounds.map((round) =>
          round.id !== roundId
            ? round
            : { ...round, nodes: round.nodes.filter((node) => node.id !== nodeId) },
        ),
        links: scheme.links.filter(
          (link) => link.source !== nodeId && link.target !== nodeId,
        ),
        positions,
      };
    });

  /** 删除分组时，一并清理该分组所有节点的晋级线和手动坐标 */
  const deleteRoundWithLinks = (roundId: string) =>
    mutateScheme((scheme) => {
      const doomed = new Set(
        scheme.rounds
          .find((round) => round.id === roundId)
          ?.nodes.map((node) => node.id) ?? [],
      );
      const positions = { ...scheme.positions };
      for (const nodeId of doomed) delete positions[nodeId];
      return {
        ...scheme,
        rounds: scheme.rounds.filter((round) => round.id !== roundId),
        links: scheme.links.filter(
          (link) => !doomed.has(link.source) && !doomed.has(link.target),
        ),
        positions,
      };
    });

  /* ---------- 晋级线操作 ---------- */

  const addLink = (source: string, target: string) =>
    mutateScheme((scheme) => {
      if (
        source === target ||
        scheme.links.some(
          (link) => link.source === source && link.target === target,
        )
      ) {
        return scheme;
      }
      return {
        ...scheme,
        links: [...scheme.links, { id: crypto.randomUUID(), source, target }],
      };
    });

  const removeLinks = (ids: string[]) =>
    mutateScheme((scheme) => ({
      ...scheme,
      links: scheme.links.filter((link) => !ids.includes(link.id)),
    }));

  /* ---------- 位置与背景 ---------- */

  const moveNode = (nodeId: string, x: number, y: number) =>
    mutateScheme((scheme) => ({
      ...scheme,
      positions: { ...scheme.positions, [nodeId]: { x, y } },
    }));

  /** 把节点拖进另一个分组：从原分组移除并追加到目标分组，落点按绝对坐标保存 */
  const moveNodeToRound = (targetRoundId: string, nodeId: string, x: number, y: number) =>
    mutateScheme((scheme) => {
      const moved = scheme.rounds
        .flatMap((round) => round.nodes)
        .find((node) => node.id === nodeId);
      if (!moved || !scheme.rounds.some((round) => round.id === targetRoundId)) {
        return scheme;
      }
      return {
        ...scheme,
        rounds: scheme.rounds.map((round) => {
          if (round.id === targetRoundId) {
            const already = round.nodes.some((node) => node.id === nodeId);
            return already ? round : { ...round, nodes: [...round.nodes, moved] };
          }
          return {
            ...round,
            nodes: round.nodes.filter((node) => node.id !== nodeId),
          };
        }),
        positions: { ...scheme.positions, [nodeId]: { x, y } },
      };
    });

  /** 整组拖动后保存该分组全部节点的绝对坐标 */
  const moveGroup = (points: { nodeId: string; x: number; y: number }[]) =>
    mutateScheme((scheme) => {
      const nextPositions = { ...scheme.positions };
      for (const point of points) nextPositions[point.nodeId] = { x: point.x, y: point.y };
      return { ...scheme, positions: nextPositions };
    });

  const autoLayout = () =>
    mutateScheme((scheme) => ({ ...scheme, positions: {} }));

  const changeBackground = (patch: Partial<SchemeBackground>) =>
    mutateScheme((scheme) => ({
      ...scheme,
      background: { ...scheme.background, ...patch },
    }));

  // 动作对象随渲染重建，保证捕获到最新的 rounds/entries（数据量小，开销可忽略）
  const actions: BracketActions = {
    onAddRound: addRound,
    onRoundRename: renameRound,
    onRoundDelete: deleteRoundWithLinks,
    onAddNode: addNode,
    onNodeRename: renameNode,
    onNodeDelete: deleteNode,
    onPlaceEntry: placeEntry,
    onClearSlot: clearSlot,
    onScoreChange: changeScore,
    onSlotImageFile: setSlotImage,
    onAddLink: addLink,
    onRemoveLinks: removeLinks,
    onNodeMove: moveNode,
    onMoveNodeToRound: moveNodeToRound,
    onGroupMove: moveGroup,
    onAutoLayout: autoLayout,
    onBackgroundChange: changeBackground,
  };

  if (!data || !activeScheme) {
    return null;
  }

  const nodeCount = rounds.reduce((sum, round) => sum + round.nodes.length, 0);
  const placedCount = rounds.reduce(
    (sum, round) =>
      sum +
      round.nodes.reduce(
        (sum, node) => sum + node.slots.filter((slot) => slot.entryId).length,
        0,
      ),
    0,
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3">
        <h1 className="m-0 text-lg font-extrabold tracking-tight text-[#66535a]">
          赛事预测
        </h1>
        <p className="m-0 hidden text-sm text-[#9b8a91] min-[560px]:inline">
          搭建晋级节点图，把选项拖进任意节点并填写比分，支持多方案保存。
        </p>
        <SchemeTransfer
          kind="prediction"
          featureName="赛事预测"
          className="ml-auto"
          schemes={data.schemes}
          onImport={importSchemes}
        />
      </header>

      <div className="shrink-0">
        <SchemeBar
        schemes={data.schemes}
        activeId={activeScheme.id}
        createLabel="新建方案（复制当前选项与节点图）"
        onSelect={selectScheme}
        onCreate={() => {
          // 新建方案 = 复制当前内容（另存为），选项/节点 id 重新映射保证各方案独立
          const entryMap = new Map(
            activeScheme.entries.map((e) => [e.id, crypto.randomUUID()]),
          );
          const nodeMap = new Map<string, string>();
          const rounds = activeScheme.rounds.map((round) => ({
            ...round,
            id: crypto.randomUUID(),
            nodes: round.nodes.map((node) => {
              const id = crypto.randomUUID();
              nodeMap.set(node.id, id);
              return {
                ...node,
                id,
                slots: node.slots.map((slot) => ({
                  ...slot,
                  entryId: slot.entryId ? (entryMap.get(slot.entryId) ?? null) : null,
                })),
              };
            }),
          }));
          const links = activeScheme.links
            .map((link) => ({
              id: crypto.randomUUID(),
              source: nodeMap.get(link.source) ?? "",
              target: nodeMap.get(link.target) ?? "",
            }))
            .filter((link) => link.source !== "" && link.target !== "");
          // 手动坐标按节点 id 一并映射
          const positions: PredictionScheme["positions"] = {};
          for (const [oldId, point] of Object.entries(activeScheme.positions)) {
            const newId = nodeMap.get(oldId);
            if (newId) positions[newId] = point;
          }
          addScheme({
            id: crypto.randomUUID(),
            name: `方案 ${data.schemes.length + 1}`,
            entries: activeScheme.entries.map((entry) => ({
              ...entry,
              id: entryMap.get(entry.id) ?? crypto.randomUUID(),
            })),
            rounds,
            links,
            positions,
            background: { ...activeScheme.background },
          });
        }}
        onDelete={deleteActiveScheme}
      />
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 min-[900px]:flex-row">
        <section
          aria-label="晋级节点图"
          className="order-2 flex min-h-0 min-w-0 flex-1 flex-col min-[900px]:order-1"
        >
          <div
            className="h-full min-h-[320px] w-full overflow-hidden rounded-2xl border border-white/70"
            style={{
              backgroundColor:
                activeScheme.background.color &&
                !activeScheme.background.color.includes("gradient")
                  ? activeScheme.background.color
                  : undefined,
              backgroundImage: activeScheme.background.image
                ? `url(${activeScheme.background.image})`
                : activeScheme.background.color.includes("gradient")
                  ? activeScheme.background.color
                  : undefined,
              backgroundSize: activeScheme.background.image ? "cover" : undefined,
              backgroundPosition: activeScheme.background.image ? "center" : undefined,
            }}
          >
            <BracketFlow
              schemeId={activeScheme.id}
              rounds={rounds}
              links={activeScheme.links}
              positions={activeScheme.positions}
              background={activeScheme.background}
              entryById={entryById}
              actions={actions}
            />
          </div>
        </section>
        <div className="order-1 flex min-h-0 min-w-0 flex-col min-[900px]:order-2 min-[900px]:w-[248px] min-[900px]:shrink-0">
          <EntryPool
            entries={entries}
            canAdd={canAddEntry}
            onAddFiles={(files) => void addFiles(files)}
            onCreate={createEntry}
            onRename={renameEntry}
            onRemove={removeEntry}
            onImageFile={(id, file) => void setEntryImage(id, file)}
          />
        </div>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1">
        <p aria-live="polite" className="m-0 text-xs text-[#9b8a91]">
          {entries.length} 个选项 · {rounds.length} 个分组 · {nodeCount} 个节点 ·{" "}
          {activeScheme.links.length} 条晋级线 · 已放置 {placedCount} 席
        </p>
        <p className="m-0 hidden text-xs text-[#c9b6bf] min-[700px]:inline">
          拖节点进其他分组即可改判归属；拖分组标题整组移动；圆点拖出画晋级线，双击删除。
        </p>
        <p
          aria-live="polite"
          className={`m-0 min-h-4 min-w-0 flex-1 text-right text-xs ${
            notice ? "text-rose-500" : "text-[#9b8a91]"
          }`}
        >
          {notice ?? ""}
        </p>
      </footer>
    </div>
  );
}
