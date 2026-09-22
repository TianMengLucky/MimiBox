import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 两步确认清除：第一次点击进入确认态，timeoutMs 内再次点击才执行 onClear，
 * 超时未确认自动复位（历史记录等不可恢复操作共用）。
 */
export function useConfirmClear(onClear: () => void, timeoutMs = 3000) {
  const [confirming, setConfirming] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

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
