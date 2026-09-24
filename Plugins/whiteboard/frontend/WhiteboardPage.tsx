import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@heroui/react";
import { Icon } from "@iconify/react";
import { fileToBackgroundImage, fileToCompressedImage } from "@components/image";
import { Board } from "./Board";
import { imageSize } from "./image";
import type { WhiteboardStore } from "./store";
import { DEFAULT_ITEM_WIDTH, emptyWhiteboardData } from "./types";
import type { BoardItem, WhiteboardData } from "./types";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export default function WhiteboardPage({ store }: { store: WhiteboardStore }) {
  const [data, setData] = useState<WhiteboardData | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);
  const itemInputRef = useRef<HTMLInputElement>(null);

  // 首次进入读取白板数据；读取失败降级为空数据
  useEffect(() => {
    let cancelled = false;
    store
      .loadWhiteboardData()
      .then((loaded) => {
        if (!cancelled) setData(loaded);
      })
      .catch((err) => {
        console.error("读取白板数据失败", err);
        if (!cancelled) {
          setData(emptyWhiteboardData());
          setNotice("读取白板数据失败，已从空白开始");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [store]);

  // 数据变化后延迟保存（拖动过程中高频更新，避免每次 pointermove 都写盘）
  useEffect(() => {
    if (!data) return;
    const timer = setTimeout(() => {
      store.saveWhiteboardData(data).catch((err) => {
        console.error("保存白板数据失败", err);
        setNotice("保存白板数据失败");
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [data, store]);

  /** 选中贴图并把它移到数组末尾（叠放最上层） */
  const selectItem = useCallback((id: string) => {
    setSelectedId(id);
    setData((current) => {
      if (!current) return current;
      const item = current.items.find((entry) => entry.id === id);
      if (!item || current.items[current.items.length - 1]?.id === id) return current;
      return {
        ...current,
        items: [...current.items.filter((entry) => entry.id !== id), item],
      };
    });
  }, []);

  const updateItem = useCallback(
    (id: string, patch: Partial<Pick<BoardItem, "x" | "y" | "width">>) => {
      setData((current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) =>
                item.id === id ? { ...item, ...patch } : item,
              ),
            }
          : current,
      );
    },
    [],
  );

  const deleteItem = useCallback((id: string) => {
    setSelectedId((current) => (current === id ? null : current));
    setData((current) =>
      current
        ? { ...current, items: current.items.filter((item) => item.id !== id) }
        : current,
    );
  }, []);

  // Delete / Backspace 删除当前选中的贴图（输入框内按键除外）
  useEffect(() => {
    if (!selectedId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      deleteItem(selectedId);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId, deleteItem]);

  /** 把图片文件设为背景图（压缩 + 读取尺寸后写入；移除背景时会清空贴图，保留贴图是安全的） */
  const setBackground = async (file: File): Promise<boolean> => {
    try {
      const image = await fileToBackgroundImage(file, 2048);
      const size = await imageSize(image);
      setData((current) => ({
        ...(current ?? emptyWhiteboardData()),
        background: { image, width: size.width, height: size.height },
      }));
      setSelectedId(null);
      return true;
    } catch (err) {
      console.error("处理背景图失败", err);
      setNotice("背景图处理失败，请换一张试试");
      return false;
    }
  };

  /**
   * 添加图片：没有背景时把第一张设为背景；已有背景时全部作为贴图，
   * 有落点坐标的（拖到画板上）围绕落点摆放，否则从左上角开始错开摆放。
   */
  const addFiles = async (files: File[], at?: { x: number; y: number }) => {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) {
      setNotice("仅支持图片文件");
      return;
    }
    const notes: string[] = [];
    const skipped = files.length - images.length;
    if (skipped > 0) notes.push(`已忽略 ${skipped} 个非图片文件`);

    if (!data?.background) {
      if (await setBackground(images[0])) {
        if (images.length > 1) {
          notes.push("第一张已设为背景，其余图片请再拖入一次作为贴图");
        }
        setNotice(notes.join("，") || null);
      }
      return;
    }

    const results = await Promise.allSettled(
      images.map(async (file, index) => {
        const image = await fileToCompressedImage(file, 256);
        const size = await imageSize(image);
        const ratio = size.height / size.width;
        // 落点为贴图中心；多张 / 无落点时逐张沿对角线错开避免完全重叠
        const shift = index * 0.05;
        const center = { x: (at?.x ?? 0.16) + shift, y: (at?.y ?? 0.16) + shift };
        return {
          id: crypto.randomUUID(),
          image,
          x: clamp(center.x - DEFAULT_ITEM_WIDTH / 2, 0, Math.max(0, 1 - DEFAULT_ITEM_WIDTH)),
          y: clamp(center.y - (DEFAULT_ITEM_WIDTH * ratio) / 2, 0, Math.max(0, 1 - DEFAULT_ITEM_WIDTH * ratio)),
          width: DEFAULT_ITEM_WIDTH,
          ratio,
        } satisfies BoardItem;
      }),
    );
    const added = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    const failed = images.length - added.length;
    if (failed > 0) notes.push(`${failed} 个图片处理失败`);
    if (added.length > 0) {
      setData((current) =>
        current ? { ...current, items: [...current.items, ...added] } : current,
      );
    }
    setNotice(notes.length > 0 ? notes.join("，") : null);
  };

  const removeBackground = () => {
    setData((current) =>
      current ? { ...current, background: null, items: [] } : current,
    );
    setSelectedId(null);
  };

  if (!data) return null;

  const hasBackground = data.background !== null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="m-0 text-lg font-extrabold tracking-tight text-[#66535a]">白板</h1>
        <p className="m-0 hidden text-sm text-[#9b8a91] min-[560px]:inline">
          上传背景图，把贴图随意拖放摆到想要的位置。
        </p>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" onPress={() => itemInputRef.current?.click()}>
            <Icon icon="lucide:sticky-note" width="16" height="16" aria-hidden="true" />
            添加贴图
          </Button>
          <Button size="sm" variant="ghost" onPress={() => bgInputRef.current?.click()}>
            <Icon icon="lucide:image" width="16" height="16" aria-hidden="true" />
            {hasBackground ? "更换背景" : "设置背景"}
          </Button>
          {hasBackground ? (
            <Button size="sm" variant="danger" onPress={removeBackground}>
              <Icon icon="lucide:trash-2" width="16" height="16" aria-hidden="true" />
              移除背景
            </Button>
          ) : null}
        </div>
      </header>

      <Board
        data={data}
        selectedId={selectedId}
        onSelect={selectItem}
        onUpdateItem={updateItem}
        onDeleteItem={deleteItem}
        onDropFiles={(files, at) => void addFiles(files, at)}
      />

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p aria-live="polite" className="m-0 text-xs text-[#9b8a91]">
          {hasBackground
            ? `${data.items.length} 张贴图 · 拖动移动，拖右下角圆点缩放，Delete 键删除选中贴图`
            : "先上传一张背景图片开始布置"}
        </p>
        <p
          aria-live="polite"
          className={`m-0 min-h-4 min-w-0 flex-1 break-all text-right text-xs ${
            notice ? "text-rose-500" : "text-[#9b8a91]"
          }`}
        >
          {notice}
        </p>
      </div>

      <input
        ref={bgInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void setBackground(file);
          event.target.value = "";
        }}
      />
      <input
        ref={itemInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          void addFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
    </div>
  );
}
