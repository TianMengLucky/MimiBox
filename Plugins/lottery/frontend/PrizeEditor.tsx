import { useEffect, useRef, useState } from "react";
import { Button, Input, ScrollShadow, Switch } from "@heroui/react";
import { Icon } from "@iconify/react";
import { FileDropZone } from "@components/FileDropZone";
import { fileToCompressedImage } from "@components/image";
import type { LotteryPrize } from "./types";

/** 奖品上限：太多扇区会挤在一起 */
export const MAX_PRIZES = 12;

/** 奖品编辑列表：改名 / 上传图片 / 删除 / 新增（修改即时生效并自动持久化） */
export function PrizeEditor({
  prizes,
  disabled,
  onChange,
}: {
  prizes: LotteryPrize[];
  disabled?: boolean;
  onChange: (prizes: LotteryPrize[]) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editingIdRef = useRef<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** 导入图片时是否用文件名（去扩展名）作为奖品名；关闭则只展示图片 */
  const [useFileName, setUseFileName] = useState(true);
  /** 取消奖品数量上限（默认最多 MAX_PRIZES 个，扇区太多会影响转盘可读性） */
  const [unlimited, setUnlimited] = useState(false);
  /** 清空奖品：两步确认，3 秒未确认自动复位 */
  const [confirmingClear, setConfirmingClear] = useState(false);
  const clearTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    setConfirmingClear(false);
    return () => window.clearTimeout(clearTimer.current);
  }, [prizes.length]);

  const clearAll = () => {
    window.clearTimeout(clearTimer.current);
    setConfirmingClear(false);
    setNotice(null);
    onChange([]);
  };

  const openFile = (prizeId: string) => {
    editingIdRef.current = prizeId;
    fileInputRef.current?.click();
  };

  const handleFile = async (file: File | undefined) => {
    const prizeId = editingIdRef.current;
    if (!file || !prizeId) return;
    try {
      const image = await fileToCompressedImage(file);
      onChange(prizes.map((p) => (p.id === prizeId ? { ...p, image } : p)));
    } catch (err) {
      console.error("处理图片失败", err);
    }
  };

  /** 拖放 / 多选添加奖品：一张图片一个奖品，文件名（去扩展名）作为默认名称 */
  const addFiles = async (files: File[]) => {
    const remaining = unlimited
      ? Number.POSITIVE_INFINITY
      : MAX_PRIZES - prizes.length;
    if (remaining <= 0) return;
    const images = files.filter((f) => f.type.startsWith("image/"));
    const notes: string[] = [];
    const skipped = files.length - images.length;
    if (skipped > 0) notes.push(`已忽略 ${skipped} 个非图片文件`);
    if (images.length > remaining) notes.push(`已达上限，仅添加前 ${remaining} 个`);
    const usable = images.slice(0, remaining);
    const results = await Promise.allSettled(
      usable.map(async (file) => ({
        id: crypto.randomUUID(),
        name: useFileName ? file.name.replace(/\.[^.]+$/, "") || "奖品" : "",
        image: await fileToCompressedImage(file),
      })),
    );
    const added = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const failed = usable.length - added.length;
    if (failed > 0) notes.push(`${failed} 个图片处理失败`);
    if (added.length > 0) onChange([...prizes, ...added]);
    setNotice(notes.length > 0 ? notes.join("，") : null);
  };

  const addPrize = () => {
    onChange([
      ...prizes,
      { id: crypto.randomUUID(), name: `奖品 ${prizes.length + 1}`, image: null },
    ]);
  };

  return (
    <div className="flex flex-col gap-2 min-[850px]:min-h-0 min-[850px]:flex-1">
      <FileDropZone
        accept="image/*"
        multiple
        disabled={disabled || (!unlimited && prizes.length >= MAX_PRIZES)}
        icon="lucide:image-plus"
        title="拖入图片添加奖品"
        hint={
          useFileName
            ? "或点击选择文件，可多选；文件名将作为奖品名"
            : "或点击选择文件，可多选；当前仅展示图片"
        }
        onFiles={(files) => void addFiles(files)}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Switch isSelected={useFileName} onChange={setUseFileName} isDisabled={disabled}>
          <Switch.Content>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
            用文件名作奖品名
          </Switch.Content>
        </Switch>
        <Switch isSelected={unlimited} onChange={setUnlimited} isDisabled={disabled}>
          <Switch.Content>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
            不限制数量
          </Switch.Content>
        </Switch>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant={confirmingClear ? "danger" : "tertiary"}
            isDisabled={disabled || prizes.length === 0}
            onPress={() => {
              window.clearTimeout(clearTimer.current);
              if (confirmingClear) {
                clearAll();
              } else {
                setConfirmingClear(true);
                clearTimer.current = window.setTimeout(() => setConfirmingClear(false), 3000);
              }
            }}
            aria-label={confirmingClear ? "再次点击确认清空奖品" : "清空奖品"}
          >
            <Icon icon="lucide:trash-2" width="16" height="16" aria-hidden="true" />
            {confirmingClear ? "确认清空？" : "清空奖品"}
          </Button>
          <Button
            variant="tertiary"
            isDisabled={disabled || (!unlimited && prizes.length >= MAX_PRIZES)}
            onPress={addPrize}
            aria-label={
              !unlimited && prizes.length >= MAX_PRIZES
                ? `最多 ${MAX_PRIZES} 个奖品，可打开“不限制数量”`
                : "添加奖品"
            }
          >
            <Icon icon="lucide:plus" width="16" height="16" aria-hidden="true" />
            添加奖品
          </Button>
        </div>
      </div>
      <p aria-live="polite" className="m-0 min-h-4 text-xs text-rose-500">{notice}</p>
      <ScrollShadow className="max-h-[340px] pr-1 min-[850px]:max-h-none min-[850px]:min-h-0 min-[850px]:flex-1">
        <ul className="flex flex-col gap-2" aria-label="奖品列表">
        {prizes.map((prize, index) => (
          <li
            key={prize.id}
            className="group relative flex items-center gap-2 rounded-2xl border border-white/60 bg-white/55 px-3 py-2"
          >
            <span className="w-5 text-center text-xs font-bold text-[#9b8a91]">
              {index + 1}
            </span>
            <button
              type="button"
              onClick={() => openFile(prize.id)}
              disabled={disabled}
              aria-label={`为“${prize.name || "未命名奖品"}”上传图片`}
              title="上传图片"
              className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-[#e7d5dd] bg-white/80 bg-cover bg-center p-0 hover:border-[#d26d9a] disabled:cursor-default"
              style={
                prize.image
                  ? { backgroundImage: `url(${prize.image})` }
                  : undefined
              }
            >
              {!prize.image && (
                <Icon icon="lucide:image-plus" width="18" height="18" className="text-[#b7a4ac]" aria-hidden="true" />
              )}
            </button>
            {prize.image && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute right-full top-1/2 z-20 mr-2 hidden -translate-y-1/2 flex-col items-center gap-1 rounded-xl border border-white/60 bg-white/95 px-2.5 py-1.5 shadow-[0_6px_18px_rgb(133_77_96/24%)] group-hover:flex"
              >
                <div
                  className="h-20 w-20 rounded-lg bg-cover bg-center"
                  style={{ backgroundImage: `url(${prize.image})` }}
                />
                <span className="max-w-[180px] truncate text-xs font-semibold text-[#66535a]">
                  {prize.name || "未命名奖品（仅图片）"}
                </span>
              </div>
            )}
            <Input
              aria-label="奖品名称"
              placeholder={prize.image ? "未命名（仅展示图片）" : "奖品名称"}
              variant="secondary"
              value={prize.name}
              disabled={disabled}
              onChange={(event) =>
                onChange(
                  prizes.map((p) =>
                    p.id === prize.id ? { ...p, name: event.target.value } : p,
                  ),
                )
              }
              className="min-w-0 flex-1"
            />
            <Button
              variant="tertiary"
              isIconOnly
              isDisabled={disabled}
              aria-label={`删除“${prize.name || "未命名奖品"}”`}
              onPress={() => onChange(prizes.filter((p) => p.id !== prize.id))}
            >
              <Icon icon="lucide:x" width="16" height="16" aria-hidden="true" />
            </Button>
          </li>
        ))}
        </ul>
      </ScrollShadow>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          void handleFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </div>
  );
}
