import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 两步确认清除：第一次点击进入确认态，timeoutMs 内再次点击才执行 onClear，
 * 超时未确认自动复位（历史记录等不可恢复操作共用）。
 * 传入 resetKey 时，其变化会立即退出确认态并清除计时
 * （如 SchemeBar 切换了目标方案），传字符串避免引用型 key 每次渲染变化。
 */
export function useConfirmClear(
  onClear: () => void,
  timeoutMs = 3000,
  resetKey?: string | number,
) {
  const [confirming, setConfirming] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    if (resetKey === undefined) return;
    setConfirming(false);
    window.clearTimeout(timer.current);
  }, [resetKey]);

  const confirm = useCallback(() => {
    window.clearTimeout(timer.current);
    if (confirming) {
      setConfirming(false);
      onClear();
    } else {
      setConfirming(true);
      timer.current = window.setTimeout(() => setConfirming(false), timeoutMs);
    }
  }, [confirming, onClear, timeoutMs]);

  return { confirming, confirm };
}
