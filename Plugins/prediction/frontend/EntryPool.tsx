import { Button, ScrollShadow } from "@heroui/react";
import { Icon } from "@iconify/react";
import { FileDropZone } from "@components/FileDropZone";
import { EntryChip } from "./EntryChip";
import type { PredictionEntry } from "./types";

/** 选项库：批量导入 / 手动创建 / 改名换图删除；选项从这里拖到任意节点 */
export function EntryPool({
  entries,
  canAdd,
  disabled,
  onAddFiles,
  onCreate,
  onRename,
  onRemove,
  onImageFile,
}: {
  entries: PredictionEntry[];
  /** 选项数未达上限时才允许继续导入 */
  canAdd: boolean;
  disabled?: boolean;
  onAddFiles: (files: File[]) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  onImageFile: (id: string, file: File) => void;
}) {
  return (
    <section
      aria-label="选项库"
      className="flex w-full min-h-0 flex-1 flex-col gap-1.5"
    >
      <FileDropZone
        accept="image/*"
        multiple
        compact
        disabled={disabled || !canAdd}
        icon="lucide:image-plus"
        title={canAdd ? "拖入图片批量创建选项" : "已达选项数量上限"}
        hint="或点击选择文件，可多选；文件名将作为选项名"
        onFiles={onAddFiles}
      />
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-[#9b8a91]">
          选项 · {entries.length}
        </span>
        <Button
          variant="tertiary"
          size="sm"
          className="ml-auto px-2.5"
          isDisabled={disabled || !canAdd}
          onPress={onCreate}
          aria-label="新建空白选项"
        >
          <Icon icon="lucide:plus" width="14" height="14" aria-hidden="true" />
          新建选项
        </Button>
      </div>
      <ScrollShadow className="min-h-16 max-h-[260px] flex-1 min-[900px]:max-h-none">
        <div className="flex min-h-full flex-wrap content-start items-start gap-2 p-0.5">
          {entries.length === 0 ? (
            <p className="m-0 w-full self-center px-1 py-2 text-xs leading-5 text-[#b7a4ac]">
              还没有选项。上传队伍图片、或点“新建选项”创建；
              把选项拖到左侧节点的任意席位即可完成一次预测。
            </p>
          ) : (
            entries.map((entry) => (
              <EntryChip
                key={entry.id}
                entry={entry}
                disabled={disabled}
                onRename={(name) => onRename(entry.id, name)}
                onRemove={() => onRemove(entry.id)}
                onImageFile={(file) => onImageFile(entry.id, file)}
              />
            ))
          )}
        </div>
      </ScrollShadow>
    </section>
  );
}
