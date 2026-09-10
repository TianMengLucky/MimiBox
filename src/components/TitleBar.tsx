import { useEffect, useState } from "react";
import { Button, ButtonGroup } from "@heroui/react";
import { Icon } from "@iconify/react";
import { useRouterState } from "@tanstack/react-router";
import appIcon from "@assets/app-icon.png";

const hasTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function MinimizeGlyph() {
  return <Icon icon="mdi:window-minimize" width="14" height="14" aria-hidden="true" />;
}

function MaximizeGlyph() {
  return <Icon icon="mdi:window-maximize" width="14" height="14" aria-hidden="true" />;
}

function RestoreGlyph() {
  return <Icon icon="mdi:window-restore" width="14" height="14" aria-hidden="true" />;
}

function CloseGlyph() {
  return <Icon icon="mdi:window-close" width="14" height="14" aria-hidden="true" />;
}

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const [version, setVersion] = useState("v0.1.0");

  // 欢迎页保持纯净：不显示左上角品牌卡片与右上角窗口控制
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isWelcome = pathname === "/";

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

  // 欢迎页：隐藏卡片与窗口控制按钮，但保留顶部拖拽区以便移动窗口
  if (isWelcome) {
    return (
      <header className="titlebar">
        <div className="titlebar__drag" data-tauri-drag-region />
      </header>
    );
  }

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
