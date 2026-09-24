import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Panel,
  Position,
  ReactFlow,
  applyNodeChanges,
} from "@xyflow/react";
import type {
  Connection,
  Edge,
  IsValidConnection,
  Node,
  NodeChange,
  NodeProps,
  NodeTypes,
  OnNodesChange,
  XYPosition,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre, { Graph as DagreGraph } from "@dagrejs/dagre";
import { Button } from "@heroui/react";
import { Icon } from "@iconify/react";
import { fileToBackgroundImage } from "@components/image";
import { MatchNode } from "./MatchNode";
import { BACKGROUND_PRESETS } from "./types";
import type {
  PredictionEntry,
  PredictionLink,
  PredictionNode,
  PredictionPoint,
  PredictionRound,
  SchemeBackground,
} from "./types";

/** 节点卡片宽度（与 MatchNode 内部布局匹配） */
const NODE_WIDTH = 204;
/** 估算节点高度：标题行 + 每席位一行（真实高度由 React Flow 量测后取代） */
const estHeight = (node: PredictionNode): number => 44 + node.slots.length * 40;
/** 分组容器的标题高度与内边距 */
const GROUP_HEADER = 36;
const GROUP_PAD = 12;
/** 分组容器节点 id 前缀（id = 前缀 + 分组 id） */
const GROUP_PREFIX = "__group_";
/** 拖拽悬停时目标分组的高亮样式 */
const GROUP_HIGHLIGHT_CLASS = "ring-2 ring-[#d26d9a]";

const roundIdOfGroup = (groupNodeId: string): string =>
  groupNodeId.slice(GROUP_PREFIX.length);

/** 节点图编辑动作集合，由页面组件实现后整体传入 */
export interface BracketActions {
  onAddRound: () => void;
  onRoundRename: (roundId: string, name: string) => void;
  onRoundDelete: (roundId: string) => void;
  onAddNode: (roundId: string) => void;
  onNodeRename: (roundId: string, nodeId: string, title: string) => void;
  onNodeDelete: (roundId: string, nodeId: string) => void;
  onPlaceEntry: (roundId: string, nodeId: string, slotIndex: number | null, entryId: string) => void;
  onClearSlot: (roundId: string, nodeId: string, slotIndex: number) => void;
  onScoreChange: (roundId: string, nodeId: string, slotIndex: number, score: string) => void;
  onSlotImageFile: (roundId: string, nodeId: string, slotIndex: number, file: File) => void;
  onAddLink: (source: string, target: string) => void;
  onRemoveLinks: (ids: string[]) => void;
  /** 拖拽结束：保存节点手动摆放的坐标（画布绝对坐标） */
  onNodeMove: (nodeId: string, x: number, y: number) => void;
  /** 把节点拖进另一个分组：改判归属并保存落点（绝对坐标） */
  onMoveNodeToRound: (targetRoundId: string, nodeId: string, x: number, y: number) => void;
  /** 整组拖动后：保存该分组全部节点的绝对坐标 */
  onGroupMove: (points: { nodeId: string; x: number; y: number }[]) => void;
  /** 清除全部手动坐标，恢复 dagre 自动布局 */
  onAutoLayout: () => void;
  /** 修改方案背景 */
  onBackgroundChange: (patch: Partial<SchemeBackground>) => void;
}

interface MatchNodeData extends Record<string, unknown> {
  node: PredictionNode;
  entryById: Map<string, PredictionEntry>;
  onTitleChange: (title: string) => void;
  onPlaceEntry: (entryId: string, slotIndex: number | null) => void;
  onClearSlot: (slotIndex: number) => void;
  onScoreChange: (slotIndex: number, score: string) => void;
  onSlotImageFile: (slotIndex: number, file: File) => void;
  onDelete: () => void;
}
type MatchFlowNode = Node<MatchNodeData, "match">;

interface RoundGroupData extends Record<string, unknown> {
  name: string;
  width: number;
  height: number;
  onRename: (name: string) => void;
  onDelete: () => void;
  onAddNode: () => void;
}
type GroupFlowNode = Node<RoundGroupData, "roundGroup">;

type FlowNode = MatchFlowNode | GroupFlowNode;

/** 比赛节点卡片：左右各一个连接圆点，用于手动画晋级线；整体可拖拽摆放 */
function MatchCard({ data }: NodeProps<MatchFlowNode>) {
  return (
    <div className="relative">
      <Handle
        type="target"
        position={Position.Left}
        className="h-4! w-4! cursor-crosshair rounded-full! border-2! border-[#d26d9a]! bg-white! transition-transform hover:scale-130!"
      />
      <MatchNode {...data} />
      <Handle
        type="source"
        position={Position.Right}
        className="h-4! w-4! cursor-crosshair rounded-full! border-2! border-[#d26d9a]! bg-white! transition-transform hover:scale-130!"
      />
    </div>
  );
}

/** 分组容器：标题行（改名 / 加节点 / 删除）+ 包住子节点的圆角框，整体可拖动 */
function RoundGroupCard({ data }: NodeProps<GroupFlowNode>) {
  const [confirming, setConfirming] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => window.clearTimeout(timer.current);
  }, []);

  return (
    <div className="flex h-full w-full flex-col rounded-2xl border border-[#e7d5dd]/90 bg-white/30 p-2.5">
      <div className="flex shrink-0 items-center gap-1">
        <span aria-hidden="true" className="h-4 w-1 shrink-0 rounded-full bg-[#f2bfd8]" />
        <input
          value={data.name}
          onChange={(event) => data.onRename(event.target.value)}
          placeholder="分组名称"
          aria-label="分组名称"
          className="nodrag min-w-0 flex-1 rounded-md border-0 bg-transparent px-1 py-0 text-sm leading-6 font-extrabold tracking-tight text-[#66535a] outline-none placeholder:font-normal placeholder:text-[#d8c7cf] focus:bg-white/80"
        />
        <Button
          variant="tertiary"
          size="sm"
          isIconOnly
          className="h-6 w-6 min-w-6 rounded-lg text-[#b7a4ac]"
          onPress={data.onAddNode}
          aria-label="在该分组里添加节点"
        >
          <Icon icon="lucide:plus" width="13" height="13" aria-hidden="true" />
        </Button>
        <Button
          variant={confirming ? "danger" : "tertiary"}
          size="sm"
          isIconOnly
          className="h-6 w-6 min-w-6 rounded-lg text-[#b7a4ac]"
          onPress={() => {
            if (confirming) {
              window.clearTimeout(timer.current);
              setConfirming(false);
              data.onDelete();
            } else {
              setConfirming(true);
              window.clearTimeout(timer.current);
              timer.current = window.setTimeout(() => setConfirming(false), 3000);
            }
          }}
          aria-label={
            confirming ? "再次点击确认删除该分组及其节点" : "删除该分组及其所有节点"
          }
        >
          <Icon icon="lucide:trash-2" width="13" height="13" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

const nodeTypes = {
  match: MatchCard,
  roundGroup: RoundGroupCard,
} as NodeTypes;

const edgeStyle = { stroke: "#d26d9a", strokeWidth: 1.5 } as const;

/** 用 dagre 计算布局：真实连线决定层级，无入线的节点用隐形边锚定在所属分组列；
    分组框则包住所属节点的包围盒 */
function computeLayout(
  rounds: PredictionRound[],
  links: PredictionLink[],
  measured: Map<string, { height: number }>,
): {
  positions: Map<string, { x: number; y: number }>;
  groupRects: Map<string, { x: number; y: number; width: number; height: number }>;
} {
  const g = new DagreGraph();
  g.setGraph({ rankdir: "LR", nodesep: 28, ranksep: 64, marginx: 16, marginy: 16 });
  g.setDefaultEdgeLabel(() => ({}));

  // 每个分组一个锚点，锚点间用高权重隐形边串联，形成稳定的列骨架
  const anchors = rounds.map((_, index) => `__anchor_${index}__`);
  anchors.forEach((id) => g.setNode(id, { width: 1, height: 1 }));
  for (let i = 0; i < anchors.length - 1; i += 1) {
    g.setEdge(anchors[i], anchors[i + 1], { weight: 10 });
  }

  const flat = rounds.flatMap((round, roundIndex) =>
    round.nodes.map((node) => ({ node, roundIndex })),
  );
  for (const { node, roundIndex } of flat) {
    g.setNode(node.id, {
      width: NODE_WIDTH,
      height: measured.get(node.id)?.height ?? estHeight(node),
    });
    const hasIncoming = links.some((link) => link.target === node.id);
    if (!hasIncoming) {
      g.setEdge(anchors[roundIndex], node.id, { weight: 3 });
    }
  }
  for (const link of links) {
    if (g.hasNode(link.source) && g.hasNode(link.target)) {
      g.setEdge(link.source, link.target, { weight: 1 });
    }
  }

  dagre.layout(g);

  const positions = new Map<string, { x: number; y: number }>();
  let rightEdge = 0;
  let topY = Number.POSITIVE_INFINITY;
  for (const { node } of flat) {
    const laid = g.node(node.id) as { x: number; y: number };
    const height = measured.get(node.id)?.height ?? estHeight(node);
    const point = { x: laid.x - NODE_WIDTH / 2, y: laid.y - height / 2 };
    positions.set(node.id, point);
    rightEdge = Math.max(rightEdge, point.x + NODE_WIDTH);
    topY = Math.min(topY, point.y);
  }

  // 分组框包住所属节点的包围盒；空分组排在所有内容右侧
  const groupRects = new Map<string, { x: number; y: number; width: number; height: number }>();
  const fallbackY = (Number.isFinite(topY) ? topY : 0) - GROUP_HEADER;
  for (const round of rounds) {
    const points = round.nodes
      .map((node) => {
        const point = positions.get(node.id);
        if (!point) return undefined;
        return {
          x: point.x,
          y: point.y,
          maxX: point.x + NODE_WIDTH,
          maxY: point.y + (measured.get(node.id)?.height ?? estHeight(node)),
        };
      })
      .filter((point) => point !== undefined);
    if (points.length > 0) {
      const minX = Math.min(...points.map((point) => point.x));
      const minY = Math.min(...points.map((point) => point.y));
      const maxX = Math.max(...points.map((point) => point.maxX));
      const maxY = Math.max(...points.map((point) => point.maxY));
      groupRects.set(round.id, {
        x: minX - GROUP_PAD,
        y: minY - GROUP_PAD - GROUP_HEADER,
        width: maxX - minX + GROUP_PAD * 2,
        height: maxY - minY + GROUP_HEADER + GROUP_PAD * 2,
      });
    } else {
      groupRects.set(round.id, {
        x: rightEdge + 40,
        y: fallbackY,
        width: NODE_WIDTH + GROUP_PAD * 2,
        height: GROUP_HEADER + 110 + GROUP_PAD * 2,
      });
    }
  }
  return { positions, groupRects };
}

/** 晋级节点图画布：React Flow 渲染 + dagre 自动布局 + 节点/分组自由拖拽 */
export function BracketFlow({
  schemeId,
  rounds,
  links,
  positions,
  background,
  entryById,
  actions,
}: {
  /** 方案 id：切换方案时作为 key 重建画布并重新适配视野 */
  schemeId: string;
  rounds: PredictionRound[];
  links: PredictionLink[];
  /** 手动拖拽保存过的节点坐标（画布绝对坐标） */
  positions: Record<string, PredictionPoint>;
  background: SchemeBackground;
  entryById: Map<string, PredictionEntry>;
  actions: BracketActions;
}) {
  /** React Flow 量测到的节点真实高度，用于 dagre 布局 */
  const [measured, setMeasured] = useState<Map<string, { height: number }>>(() => new Map());
  /** 画布节点（受控）：拖拽期间只改本地状态，落点后经动作写入方案 */
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const bgInputRef = useRef<HTMLInputElement>(null);

  /** 按当前数据重建节点列表（分组框在前，节点在后且以分组为父节点） */
  const rebuild = useCallback((): FlowNode[] => {
    const { positions: layout, groupRects } = computeLayout(rounds, links, measured);
    const list: FlowNode[] = [];
    for (const round of rounds) {
      const rect = groupRects.get(round.id);
      if (!rect) continue;
      list.push({
        id: `${GROUP_PREFIX}${round.id}`,
        type: "roundGroup",
        position: { x: rect.x, y: rect.y },
        style: { width: rect.width, height: rect.height },
        selectable: false,
        deletable: false,
        data: {
          name: round.name,
          width: rect.width,
          height: rect.height,
          onRename: (name: string) => actions.onRoundRename(round.id, name),
          onDelete: () => actions.onRoundDelete(round.id),
          onAddNode: () => actions.onAddNode(round.id),
        },
      });
    }
    for (const round of rounds) {
      const rect = groupRects.get(round.id);
      if (!rect) continue;
      for (const node of round.nodes) {
        const abs = positions[node.id] ?? layout.get(node.id);
        if (!abs) continue;
        list.push({
          id: node.id,
          type: "match",
          parentId: `${GROUP_PREFIX}${round.id}`,
          position: { x: abs.x - rect.x, y: abs.y - rect.y },
          selectable: false,
          deletable: false,
          data: {
            node,
            entryById,
            onTitleChange: (title: string) => actions.onNodeRename(round.id, node.id, title),
            onPlaceEntry: (entryId: string, slotIndex: number | null) =>
              actions.onPlaceEntry(round.id, node.id, slotIndex, entryId),
            onClearSlot: (slotIndex: number) => actions.onClearSlot(round.id, node.id, slotIndex),
            onScoreChange: (slotIndex: number, score: string) =>
              actions.onScoreChange(round.id, node.id, slotIndex, score),
            onSlotImageFile: (slotIndex: number, file: File) =>
              actions.onSlotImageFile(round.id, node.id, slotIndex, file),
            onDelete: () => actions.onNodeDelete(round.id, node.id),
          },
        });
      }
    }
    return list;
  }, [rounds, links, measured, positions, entryById, actions]);

  useEffect(() => {
    setNodes(rebuild());
  }, [rebuild]);

  const flowEdges = useMemo<Edge[]>(
    () =>
      links.map((link) => ({
        id: link.id,
        source: link.source,
        target: link.target,
        type: "smoothstep",
        style: edgeStyle,
      })),
    [links],
  );

  /** 拖拽/量测变化只更新本地状态；落点后的持久化交给拖拽结束回调 */
  const onNodesChange: OnNodesChange<FlowNode> = useCallback((changes) => {
    setNodes((current) => applyNodeChanges(changes, current));
    const dims = changes.filter(
      (change): change is Extract<NodeChange<FlowNode>, { type: "dimensions" }> =>
        change.type === "dimensions",
    );
    if (dims.length === 0) return;
    setMeasured((prev) => {
      const next = new Map(prev);
      let changed = false;
      for (const change of dims) {
        const height = change.dimensions?.height;
        if (!height) continue;
        if (next.get(change.id)?.height !== height) {
          next.set(change.id, { height });
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  /** 节点当前的中心点（绝对坐标：父分组位置 + 相对位置） */
  const absCenterOf = useCallback(
    (node: FlowNode): XYPosition => {
      const height = node.measured?.height ?? estHeight((node.data as MatchNodeData).node);
      let x = node.position.x;
      let y = node.position.y;
      if (node.parentId) {
        const parent = nodes.find((n) => n.id === node.parentId);
        if (parent) {
          x += parent.position.x;
          y += parent.position.y;
        }
      }
      return { x: x + NODE_WIDTH / 2, y: y + height / 2 };
    },
    [nodes],
  );

  /** 找中心点落在哪个分组的框里（可排除自己的分组）；没命中返回 null */
  const groupAtPoint = useCallback(
    (point: XYPosition, excludeGroupId?: string): string | null => {
      for (const candidate of nodes) {
        if (candidate.type !== "roundGroup" || candidate.id === excludeGroupId) continue;
        const rect = candidate.data as RoundGroupData;
        if (
          point.x >= candidate.position.x &&
          point.x <= candidate.position.x + rect.width &&
          point.y >= candidate.position.y &&
          point.y <= candidate.position.y + rect.height
        ) {
          return candidate.id;
        }
      }
      return null;
    },
    [nodes],
  );

  const clearHighlight = useCallback(() => {
    setNodes((current) =>
      current.map((node) =>
        node.type === "roundGroup" && node.className
          ? { ...node, className: undefined }
          : node,
      ),
    );
  }, []);

  /** 拖动节点时高亮可作为新归属的分组 */
  const onNodeDrag = useCallback(
    (_event: unknown, node: FlowNode) => {
      if (node.type !== "match") return;
      const target = groupAtPoint(absCenterOf(node), node.parentId);
      const targetClass = target ? GROUP_HIGHLIGHT_CLASS : undefined;
      setNodes((current) =>
        current.map((candidate) => {
          if (candidate.type !== "roundGroup") return candidate;
          const next = candidate.id === target ? targetClass : undefined;
          return candidate.className === next
            ? candidate
            : { ...candidate, className: next };
        }),
      );
    },
    [absCenterOf, groupAtPoint],
  );

  /** 拖拽结束：节点按落点改判分组 / 保存位置；整组拖动则保存全部子节点坐标 */
  const onNodeDragStop = useCallback(
    (_event: unknown, node: FlowNode) => {
      clearHighlight();
      if (node.type === "match") {
        const center = absCenterOf(node);
        const target = groupAtPoint(center, node.parentId);
        if (target) {
          const abs = {
            x: center.x - NODE_WIDTH / 2,
            y: center.y - (node.measured?.height ?? estHeight(node.data.node)) / 2,
          };
          actions.onMoveNodeToRound(roundIdOfGroup(target), node.id, abs.x, abs.y);
          return;
        }
        // 没拖进别的分组：落在本分组内则保存位置，拖出界则回弹
        const parent = node.parentId
          ? nodes.find((candidate) => candidate.id === node.parentId)
          : undefined;
        const insideOwn = parent
          ? center.x >= parent.position.x &&
            center.x <= parent.position.x + (parent.data as RoundGroupData).width &&
            center.y >= parent.position.y &&
            center.y <= parent.position.y + (parent.data as RoundGroupData).height
          : false;
        if (insideOwn) {
          actions.onNodeMove(
            node.id,
            center.x - NODE_WIDTH / 2,
            center.y - (node.measured?.height ?? estHeight(node.data.node)) / 2,
          );
        } else {
          setNodes(rebuild());
        }
        return;
      }
      if (node.type === "roundGroup") {
        const points = nodes
          .filter((candidate) => candidate.type === "match" && candidate.parentId === node.id)
          .map((candidate) => ({
            nodeId: candidate.id,
            x: node.position.x + candidate.position.x,
            y: node.position.y + candidate.position.y,
          }));
        actions.onGroupMove(points);
      }
    },
    [absCenterOf, groupAtPoint, clearHighlight, nodes, rebuild, actions],
  );

  const canConnect = useCallback<IsValidConnection>(
    (connection) => {
      const { source, target } = connection;
      if (!source || !target || source === target) return false;
      if (links.some((link) => link.source === source && link.target === target)) {
        return false;
      }
      const from = roundIndexOf(rounds, source);
      const to = roundIndexOf(rounds, target);
      // 晋级线只能从靠前的分组指向靠后的分组（左 → 右）
      return from !== undefined && to !== undefined && from < to;
    },
    [rounds, links],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!canConnect(connection)) return;
      if (connection.source && connection.target) {
        actions.onAddLink(connection.source, connection.target);
      }
    },
    [canConnect, actions],
  );

  const handleBackgroundFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const image = await fileToBackgroundImage(file);
      actions.onBackgroundChange({ image });
    } catch (err) {
      console.error("处理背景图失败", err);
    }
  };

  return (
    <ReactFlow
      key={schemeId}
      nodes={nodes}
      edges={flowEdges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeDrag={onNodeDrag}
      onNodeDragStop={onNodeDragStop}
      onConnect={handleConnect}
      isValidConnection={canConnect}
      onEdgeDoubleClick={(_, edge) => actions.onRemoveLinks([edge.id])}
      zoomOnDoubleClick={false}
      elementsSelectable={false}
      deleteKeyCode={null}
      connectionRadius={36}
      fitView
      fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
      minZoom={0.2}
      maxZoom={1.5}
      defaultEdgeOptions={{ type: "smoothstep", style: edgeStyle }}
      connectionLineStyle={edgeStyle}
    >
      {!background.color && !background.image ? (
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.6} color="#ecd6e0" />
      ) : null}
      <Controls position="bottom-right" showInteractive={false} />

      <Panel position="top-left">
        <div className="flex items-center gap-1.5">
          <Button
            variant="tertiary"
            size="sm"
            className="rounded-full border border-dashed border-[#e7d5dd] bg-white/80 px-3 text-xs font-semibold text-[#9b8a91] hover:text-[#66535a]"
            onPress={actions.onAddRound}
            aria-label="添加一个分组"
          >
            <Icon icon="lucide:plus" width="14" height="14" aria-hidden="true" />
            添加分组
          </Button>
          <Button
            variant="tertiary"
            size="sm"
            className="rounded-full bg-white/80 px-3 text-xs font-semibold text-[#9b8a91] hover:text-[#66535a]"
            onPress={actions.onAutoLayout}
            aria-label="清除手动摆放，恢复自动布局"
          >
            <Icon icon="lucide:layout-grid" width="14" height="14" aria-hidden="true" />
            整理布局
          </Button>
        </div>
      </Panel>

      <Panel position="top-right">
        <div className="flex items-center gap-1.5 rounded-full border border-white/70 bg-white/80 px-2.5 py-1 shadow-sm">
          <span className="text-xs font-bold text-[#9b8a91]">背景</span>
          {BACKGROUND_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              aria-label={`背景：${preset.label}`}
              aria-pressed={background.color === preset.value}
              title={preset.label}
              onClick={() => actions.onBackgroundChange({ color: preset.value })}
              style={{
                background: preset.value || undefined,
              }}
              className={`h-[18px] w-[18px] shrink-0 cursor-pointer rounded-full border border-black/10 p-0 shadow-none transition-transform hover:scale-110 ${
                background.color === preset.value ? "ring-2 ring-[#d26d9a]" : ""
              }`}
            >
              {!preset.value && (
                <Icon
                  icon="lucide:circle-off"
                  width="12"
                  height="12"
                  className="mx-auto text-[#b7a4ac]"
                  aria-hidden="true"
                />
              )}
            </button>
          ))}
          <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-[#e7d5dd]" />
          <button
            type="button"
            onClick={() => bgInputRef.current?.click()}
            aria-label="上传背景图"
            title="上传背景图"
            className="flex h-[18px] w-[18px] shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-[#b7a4ac] shadow-none hover:text-[#d26d9a]"
          >
            <Icon icon="lucide:image-plus" width="14" height="14" aria-hidden="true" />
          </button>
          {background.image && (
            <button
              type="button"
              onClick={() => actions.onBackgroundChange({ image: null })}
              aria-label="移除背景图"
              title="移除背景图"
              className="flex h-[18px] w-[18px] shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-[#b7a4ac] shadow-none hover:text-rose-500"
            >
              <Icon icon="lucide:x" width="14" height="14" aria-hidden="true" />
            </button>
          )}
        </div>
      </Panel>

      <input
        ref={bgInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          void handleBackgroundFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </ReactFlow>
  );
}

/** 节点所在分组下标；找不到返回 undefined */
function roundIndexOf(rounds: PredictionRound[], nodeId: string): number | undefined {
  for (let index = 0; index < rounds.length; index += 1) {
    if (rounds[index].nodes.some((node) => node.id === nodeId)) return index;
  }
  return undefined;
}
