import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { invoke } from "@tauri-apps/api/core";
import WelcomeScreen from "@components/screen/WelcomeScreen";

export const Route = createFileRoute("/")({
  component: WelcomeRoute,
});

function WelcomeRoute() {
  const navigate = useNavigate();
  const [showWelcome, setShowWelcome] = useState<boolean | null>(null);

  useEffect(() => {
    // 开发模式下默认视为第一次启动，方便每次调试欢迎页
    if (import.meta.env.DEV) {
      setShowWelcome(true);
      return;
    }
    invoke<boolean>("is_first_launch")
      .then((firstLaunch) => setShowWelcome(firstLaunch))
      .catch((err) => {
        console.error("读取启动配置失败", err);
        setShowWelcome(true);
      });
  }, []);

  if (showWelcome === null) {
    return null;
  }

  if (!showWelcome) {
    navigate({ to: "/home", replace: true });
    return null;
  }

  return (
    <WelcomeScreen
      onContinue={() => {
        setShowWelcome(false);
        invoke("mark_welcome_seen").catch((err) =>
          console.error("写入启动配置失败", err),
        );
        navigate({ to: "/home" });
      }}
      onLeave={() => {
        if ("__TAURI_INTERNALS__" in window) {
          import("@tauri-apps/api/window")
            .then(({ getCurrentWindow }) => getCurrentWindow().close())
            .catch((err) => console.error("关闭窗口失败", err));
        }
      }}
    />
  );
}
