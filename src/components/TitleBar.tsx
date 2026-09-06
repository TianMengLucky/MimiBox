import { useEffect, useState } from "react";
import { Button, ButtonGroup } from "@heroui/react";
import appIcon from "@assets/app-icon.png";

const hasTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function MinimizeGlyph() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
    </svg>
  );
}

function MaximizeGlyph() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  );
}

function RestoreGlyph() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="5" width="10.5" height="10.5" rx="2" />
      <rect x="8.5" y="8.5" width="10.5" height="10.5" rx="2" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const [version, setVersion] = useState("v0.1.0");

  useEffect(() => {
    if (!hasTauri) return;
    void import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then((value) => setVersion(`v${value}`))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!hasTauri) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      if (disposed) return;
      setMaximized((await win.isMaximized().catch(() => false)) ?? false);
      const off = await win.onResized(() => {
        if (disposed) return;
        void win
          .isMaximized()
          .then((value) => setMaximized(!!value))
          .catch(() => {});
      });
      if (disposed) off();
      else unlisten = off;
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const minimize = async () => {
    if (!hasTauri) return;
    const win = (await import("@tauri-apps/api/window")).getCurrentWindow();
    await win.minimize();
  };

  const toggleMaximize = async () => {
    if (!hasTauri) return;
    const win = (await import("@tauri-apps/api/window")).getCurrentWindow();
    await win.toggleMaximize();
  };

  const close = async () => {
    if (!hasTauri) return;
    const win = (await import("@tauri-apps/api/window")).getCurrentWindow();
    await win.close();
  };

  return (
    <header className="titlebar">
      <div className="titlebar__drag" data-tauri-drag-region />
      <div className="titlebar__brand" aria-hidden="true">
        <img className="titlebar__brand-icon" src={appIcon} alt="" />
        <span className="titlebar__brand-text">
          <span className="titlebar__brand-name">美美工具箱</span>
          <span className="titlebar__brand-version">{version}</span>
        </span>
      </div>
      <ButtonGroup
        orientation="horizontal"
        variant="tertiary"
        className="titlebar__group"
        aria-label="窗口控制"
      >
        <Button
          isIconOnly
          className="titlebar__control"
          aria-label="最小化"
          onPress={() => void minimize()}
        >
          <MinimizeGlyph />
        </Button>
        <Button
          isIconOnly
          className="titlebar__control"
          aria-label={maximized ? "还原" : "最大化"}
          aria-pressed={maximized}
          onPress={() => void toggleMaximize()}
        >
          {maximized ? <RestoreGlyph /> : <MaximizeGlyph />}
        </Button>
        <Button
          isIconOnly
          className="titlebar__control"
          aria-label="关闭"
          onPress={() => void close()}
        >
          <CloseGlyph />
        </Button>
      </ButtonGroup>
    </header>
  );
}
