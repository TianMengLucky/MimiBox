import { useState } from "react";
import { Button, Input, Slider } from "@heroui/react";
import { Icon } from "@iconify/react";
import type { RatingItem } from "./types";
import { SCORE_MAX, SCORE_MIN, SCORE_STEP, formatScore } from "./types";

/** Slider 单值模式下 onChange/onChangeEnd 的 value 仍是 number | number[]，取第一个 */
const asNumber = (value: number | number[]): number | null =>
  Array.isArray(value) ? (value[0] ?? null) : value;

/** 评分卡片：点击名称改名 / 拖动滑杆打分（1-10，0.5 一档）/ 删除 */
export function RatingCard({
  item,
  onRename,
  onScore,
  onRemove,
}: {
  item: RatingItem;
  onRename: (name: string) => void;
  onScore: (score: number) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(item.name);
  /** 拖动/键盘调节过程中的临时评分；松手（onChangeEnd）才落库，避免中途反复写盘 */
  const [dragScore, setDragScore] = useState<number | null>(null);

  const rated = item.score !== null;
  const shownScore = dragScore ?? item.score;
  const sliderValue = shownScore ?? (SCORE_MIN + SCORE_MAX) / 2;

  const startEdit = () => {
    setDraftName(item.name);
    setEditing(true);
  };

  const commitRename = () => {
    setEditing(false);
    const name = draftName.trim();
    if (name && name !== item.name) onRename(name);
  };

  return (
    <article
      className={`flex flex-col gap-2 rounded-2xl border px-4 pt-3 pb-3.5 shadow-[0_4px_16px_rgb(133_77_96/10%)] ${
        rated ? "border-white/70 bg-white/70" : "border-white/55 bg-white/45"
      }`}
    >
      <div className="flex items-center gap-1">
        {editing ? (
          <Input
            aria-label="选项名称"
            variant="secondary"
            className="min-w-0 flex-1"
            value={draftName}
            autoFocus
            onChange={(event) => setDraftName(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitRename();
              if (event.key === "Escape") {
                setEditing(false);
                setDraftName(item.name);
              }
            }}
          />
        ) : (
          <button
            type="button"
            title="点击重命名"
            className="m-0 min-w-0 flex-1 truncate text-left text-sm font-semibold text-[#66535a] hover:underline focus-visible:underline"
            onClick={startEdit}
          >
            {item.name}
          </button>
        )}
        <Button
          variant="tertiary"
          isIconOnly
          className="shrink-0 text-[#b7a4ac] hover:text-[#d26d9a]"
          aria-label={`删除 ${item.name}`}
          onPress={onRemove}
        >
          <Icon icon="lucide:x" width="14" height="14" aria-hidden="true" />
        </Button>
      </div>

      <p className="m-0 flex items-baseline gap-1">
        <span className="text-3xl leading-none font-extrabold tabular-nums text-[#66535a]">
          {shownScore === null ? "–" : formatScore(shownScore)}
        </span>
        <span className="text-xs font-semibold text-[#9b8a91]">
          {shownScore === null ? "未评分" : "/ 10 分"}
        </span>
      </p>

      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="text-[10px] font-semibold text-[#b7a4ac]">
          {SCORE_MIN}
        </span>
        <Slider
          aria-label={`${item.name} 的评分`}
          className="min-w-0 flex-1"
          value={sliderValue}
          minValue={SCORE_MIN}
          maxValue={SCORE_MAX}
          step={SCORE_STEP}
          onChange={(value) => setDragScore(asNumber(value))}
          onChangeEnd={(value) => {
            setDragScore(null);
            const n = asNumber(value);
            // 对齐 0.5 网格，消除浮点误差
            if (n !== null) onScore(Math.round(n * 2) / 2);
          }}
        >
          <Slider.Track className="h-1.5 bg-[#efe3e8]">
            <Slider.Fill className="bg-[#d26d9a]" />
            <Slider.Thumb className="border-white bg-[#d26d9a]" />
          </Slider.Track>
        </Slider>
        <span aria-hidden="true" className="text-[10px] font-semibold text-[#b7a4ac]">
          {SCORE_MAX}
        </span>
      </div>
    </article>
  );
}
