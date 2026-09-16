import { useEffect, useState } from "react";
import { Button, Checkbox, Modal, ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { Icon } from "@iconify/react";
import { exportSchemes, importSchemes } from "./io";
import type { MizKind } from "./io";

/**
 * 方案导入导出：四个有方案的功能（抽奖/夯到拉/赛事预测/评分）共用。
 * 导出为应用专属 .miz（zip）方案包，导入时可勾选包内的多个方案合并进当前数据。
 * 方案 id 冲突由调用方在 onImport 中处理（组件只负责挑选）。
 */
export function SchemeTransfer<T extends { id: string; name: string }>({
  kind,
  featureName,
  schemes,
  onImport,
  className,
}: {
  kind: MizKind;
  /** 功能名，用于按钮与提示文案 */
  featureName: string;
  /** 当前功能的全部方案（导出候选） */
  schemes: T[];
  /** 确认导入时回调选中的方案（来自文件，未做 id 处理） */
  onImport: (imported: T[]) => void;
  /** 透传给触发按钮的类名（如 ml-auto 靠右） */
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<"export" | "import">("export");
  /** 导出勾选的方案 id / 导入文件里的方案（勾选其下标） */
  const [exportIds, setExportIds] = useState<Set<string>>(new Set());
  const [imported, setImported] = useState<T[] | null>(null);
  const [importIds, setImportIds] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // 每次打开都回到导出模式并全选当前方案
  useEffect(() => {
    if (isOpen) {
      setMode("export");
      setExportIds(new Set(schemes.map((s) => s.id)));
      setImported(null);
      setImportIds(new Set());
      setNotice(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const selectedSchemes = schemes.filter((s) => exportIds.has(s.id));
  const selectedImport = imported
    ? imported.filter((_, index) => importIds.has(index))
    : [];

  const handleExport = async () => {
    if (selectedSchemes.length === 0 || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const name =
        selectedSchemes.length === 1
          ? selectedSchemes[0].name
          : `${featureName}方案`;
      const result = await exportSchemes(kind, selectedSchemes, name);
      if (result === "saved") {
        setIsOpen(false);
      } else {
        setNotice("已取消导出");
      }
    } catch (err) {
      console.error("导出方案失败", err);
      setNotice("导出失败，请重试");
    } finally {
      setBusy(false);
    }
  };

  const handlePickFile = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const list = await importSchemes<T>(kind);
      if (list === null) {
        setNotice(null);
      } else if (list.length === 0) {
        setNotice("方案包里没有可导入的方案");
      } else {
        setImported(list);
        setImportIds(new Set(list.map((_, index) => index)));
      }
    } catch (err) {
      console.error("读取方案包失败", err);
      setNotice(err instanceof Error ? err.message : "读取方案包失败");
    } finally {
      setBusy(false);
    }
  };

  const handleImport = () => {
    if (selectedImport.length === 0) return;
    onImport(selectedImport);
    setIsOpen(false);
  };

  return (
    <>
      <Button
        variant="tertiary"
        className={`rounded-full bg-white/45 font-semibold text-[#9b8a91] hover:text-[#66535a] focus-visible:text-[#66535a] ${className ?? ""}`}
        aria-label="导入或导出方案"
        onPress={() => setIsOpen(true)}
      >
        <Icon icon="lucide:package-open" width="16" height="16" aria-hidden="true" />
        导入 / 导出
      </Button>

      <Modal.Backdrop
        isOpen={isOpen}
        onOpenChange={(open) => {
          if (!open) setIsOpen(false);
        }}
      >
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-[420px]">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>导入 / 导出方案</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <ToggleButtonGroup
                aria-label="导入或导出"
                selectionMode="single"
                selectedKeys={new Set([mode])}
                onSelectionChange={(keys) => {
                  const key = [...keys][0];
                  if (key === "export" || key === "import") setMode(key);
                }}
                className="self-start"
              >
                <ToggleButton
                  id="export"
                  aria-label="导出方案"
                  className="rounded-full px-3.5 text-sm font-semibold"
                >
                  导出
                </ToggleButton>
                <ToggleButton
                  id="import"
                  aria-label="导入方案"
                  className="rounded-full px-3.5 text-sm font-semibold"
                >
                  导入
                </ToggleButton>
              </ToggleButtonGroup>

              {mode === "export" ? (
                schemes.length === 0 ? (
                  <p className="m-0 text-sm text-[#9b8a91]">还没有可导出的方案。</p>
                ) : (
                  <div
                    role="group"
                    aria-label="选择要导出的方案"
                    className="flex max-h-56 flex-col gap-1.5 overflow-y-auto pr-1"
                  >
                    {schemes.map((scheme) => (
                      <Checkbox
                        key={scheme.id}
                        isSelected={exportIds.has(scheme.id)}
                        onChange={(selected) => {
                          setExportIds((prev) => {
                            const next = new Set(prev);
                            if (selected) next.add(scheme.id);
                            else next.delete(scheme.id);
                            return next;
                          });
                        }}
                      >
                        <Checkbox.Content>
                          <Checkbox.Control>
                            <Checkbox.Indicator />
                          </Checkbox.Control>
                          <span className="truncate">{scheme.name}</span>
                        </Checkbox.Content>
                      </Checkbox>
                    ))}
                  </div>
                )
              ) : imported === null ? (
                <div className="flex flex-col items-start gap-2">
                  <p className="m-0 text-sm text-[#9b8a91]">
                    选择一个 .miz 方案包（由本应用导出），可从中勾选多个方案合并进来。
                  </p>
                  <Button isDisabled={busy} onPress={() => void handlePickFile()}>
                    <Icon icon="lucide:folder-open" width="16" height="16" aria-hidden="true" />
                    {busy ? "正在读取…" : "选择方案包"}
                  </Button>
                </div>
              ) : (
                <div
                  role="group"
                  aria-label="选择要导入的方案"
                  className="flex max-h-56 flex-col gap-1.5 overflow-y-auto pr-1"
                >
                  {imported.map((scheme, index) => (
                    <Checkbox
                      key={`${scheme.id}-${index}`}
                      isSelected={importIds.has(index)}
                      onChange={(selected) => {
                        setImportIds((prev) => {
                          const next = new Set(prev);
                          if (selected) next.add(index);
                          else next.delete(index);
                          return next;
                        });
                      }}
                    >
                      <Checkbox.Content>
                        <Checkbox.Control>
                          <Checkbox.Indicator />
                        </Checkbox.Control>
                        <span className="truncate">{scheme.name}</span>
                      </Checkbox.Content>
                    </Checkbox>
                  ))}
                </div>
              )}

              <p aria-live="polite" className="m-0 min-h-4 text-xs text-rose-500">
                {notice}
              </p>
            </Modal.Body>
            <Modal.Footer>
              <Button slot="close" variant="secondary">
                关闭
              </Button>
              {mode === "export" ? (
                <Button
                  isDisabled={schemes.length === 0 || selectedSchemes.length === 0 || busy}
                  onPress={() => void handleExport()}
                >
                  <Icon icon="lucide:package-open" width="16" height="16" aria-hidden="true" />
                  导出 {selectedSchemes.length} 个方案
                </Button>
              ) : (
                <Button
                  isDisabled={imported === null || selectedImport.length === 0}
                  onPress={handleImport}
                >
                  <Icon icon="lucide:package-check" width="16" height="16" aria-hidden="true" />
                  导入 {selectedImport.length} 个方案
                </Button>
              )}
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  );
}
