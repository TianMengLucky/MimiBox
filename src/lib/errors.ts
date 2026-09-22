/** 提取未知错误的可展示文本（catch 块中 err 类型为 unknown） */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
