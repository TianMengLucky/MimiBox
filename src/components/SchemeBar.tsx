import { useEffect, useRef, useState } from "react";
import { Button, Label, ListBox, Select } from "@heroui/react";
import { Icon } from "@iconify/react";

/** 方案管理条：切换活动方案 / 新建（复制当前内容）/ 删除，抽奖与夯到拉共用 */
export function SchemeBar<T extends { id: string; name: string }>({
  schemes,
  activeId,
  disabled,
  createLabel,
  onSelect,
  onCreate,
  onDelete,
}: {
  schemes: T[];
  activeId: string | null;
  /** 上游操作进行中时禁用编辑 */
  disabled?: boolean;
  /** 新建按钮的说明文案（同时用作 aria-label） */
  createLabel: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: () => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const resetTimer = useRef<number | undefined>(undefined);

  // 方案切换或数量变化时退出“确认删除”态
  useEffect(() => {
    setConfirmingDelete(false);
    return () => window.clearTimeout(resetTimer.current);
  }, [activeId, schemes.length]);

  const armDelete = () => {
    setConfirmingDelete(true);
    window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setConfirmingDelete(false), 3000);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label="选择方案"
        className="w-[200px] flex-1"
        value={activeId}
        isDisabled={disabled}
        onChange={(value) => {
          if (typeof value === "string") onSelect(value);
        }}
      >
        <Label className="sr-only">方案</Label>
        <Select.Trigger>
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            {schemes.map((scheme) => (
              <ListBox.Item key={scheme.id} id={scheme.id} textValue={scheme.name}>
                {scheme.name}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
      <Button
        variant="tertiary"
        isIconOnly
        isDisabled={disabled}
        aria-label={createLabel}
        onPress={onCreate}
      >
        <Icon icon="lucide:plus" width="18" height="18" aria-hidden="true" />
      </Button>
      <Button
        variant={confirmingDelete ? "danger" : "tertiary"}
        isDisabled={disabled}
        aria-label={confirmingDelete ? "再次点击确认删除方案" : "删除当前方案"}
        onPress={() => {
          if (confirmingDelete) {
            window.clearTimeout(resetTimer.current);
            setConfirmingDelete(false);
            onDelete();
          } else {
            armDelete();
          }
        }}
      >
        <Icon icon="lucide:trash-2" width="16" height="16" aria-hidden="true" />
        {confirmingDelete ? "确认删除？" : "删除方案"}
      </Button>
    </div>
  );
}
