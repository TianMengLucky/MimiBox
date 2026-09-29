import { useEffect, useState } from "react";

import { hasTauri } from "./tauriInvoke";

/** 应用版本号（非 Tauri 环境返回占位值；TitleBar 与关于页共用） */
export function useAppVersion(): string {
  const [version, setVersion] = useState("v0.1.0");

  useEffect(() => {
    if (!hasTauri) return;
    void import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then((value) => setVersion(`v${value}`))
      .catch(() => {});
  }, []);

  return version;
}
