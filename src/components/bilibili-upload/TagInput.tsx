"use no memo";

import { useState, type KeyboardEvent } from "react";
import { Icon } from "@iconify/react";

/** 标签输入：回车/逗号添加，点击 × 删除，上限 10 个 */
export function TagInput({
  tags,
  disabled,
  onChange,
}: {
  tags: string[];
  disabled?: boolean;
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const full = tags.length >= 10;

  const add = () => {
    const value = draft.trim().replace(/[,，]/g, "");
    if (!value || full) return;
    if (tags.some((tag) => tag.toLowerCase() === value.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...tags, value]);
    setDraft("");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add();
    } else if (event.key === "Backspace" && draft === "" && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  };

  return (
    <div
      className={`flex flex-wrap items-center gap-1.5 rounded-2xl border px-3 py-2 ${
        full ? "border-[#f3c4d8] bg-[#fff1f7]/60" : "border-[#e7d5dd] bg-white/60"
      }`}
    >
      {tags.map((tag, index) => (
        <span
          key={tag}
          className="flex items-center gap-1 rounded-full bg-[#fdeef5] py-0.5 pl-2.5 pr-1 text-xs font-bold text-[#c25582]"
        >
          {tag}
          {!disabled && (
            <button
              type="button"
              aria-label={`删除标签 ${tag}`}
              className="flex cursor-pointer items-center rounded-full p-0.5 text-[#d990b0] hover:bg-[#f8dcea] hover:text-[#c25582]"
              onClick={() => onChange(tags.filter((_, i) => i !== index))}
            >
              <Icon icon="lucide:x" width="12" height="12" aria-hidden="true" />
            </button>
          )}
        </span>
      ))}
      {!full && !disabled && (
        <input
          type="text"
          value={draft}
          placeholder={tags.length === 0 ? "输入标签后回车添加，至少 1 个" : "继续添加…"}
          aria-label="添加标签"
          className="min-w-32 flex-1 bg-transparent text-sm text-[#66535a] outline-none placeholder:text-[#bfa9b2]"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={add}
        />
      )}
      <span className="ml-auto text-xs text-[#bfa9b2]" aria-live="polite">
        {tags.length} / 10
      </span>
    </div>
  );
}
