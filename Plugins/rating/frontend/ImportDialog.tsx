import { useEffect, useState } from "react";
import { Button, Modal, TextArea } from "@heroui/react";
import { Icon } from "@iconify/react";

/** 批量导入对话框：粘贴多行文本，每行一个选项名，一次全部导入 */
export function ImportDialog({
  isOpen,
  remaining,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  /** 还能导入多少个选项（上限减去现有数量） */
  remaining: number;
  onClose: () => void;
  onSubmit: (names: string[]) => void;
}) {
  const [text, setText] = useState("");
  // 每次打开都从空白开始
  useEffect(() => {
    if (isOpen) setText("");
  }, [isOpen]);

  const names = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const count = Math.min(names.length, Math.max(0, remaining));
  const overflow = names.length - count;

  return (
    <Modal.Backdrop
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-[440px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>批量导入选项</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <p className="m-0 text-sm text-[#9b8a91]">
              每行一个选项名，可以从列表里直接复制粘贴。
            </p>
            <TextArea
              aria-label="选项名称，每行一个"
              className="h-44 w-full"
              placeholder={"例如：\n第一期 成片\n第一期 片头\n第二期 成片"}
              value={text}
              autoFocus
              onChange={(event) => setText(event.target.value)}
            />
            <p aria-live="polite" className="m-0 min-h-4 text-xs text-[#9b8a91]">
              {names.length > 0
                ? `将导入 ${count} 个选项${overflow > 0 ? `，超出上限已忽略 ${overflow} 个` : ""}`
                : null}
            </p>
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="secondary">
              取消
            </Button>
            <Button
              slot="close"
              isDisabled={count === 0}
              onPress={() => onSubmit(names.slice(0, Math.max(0, remaining)))}
            >
              <Icon icon="lucide:list-plus" width="16" height="16" aria-hidden="true" />
              导入 {count > 0 ? count : ""}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
