import { useSyncExternalStore } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { featureRegistry } from "../../core/registry";
import { pluginRuntime } from "../../core/runtime";
import ComingSoon from "@components/screen/ComingSoon";
import { PageLoading } from "@components/screen/PageLoading";

export const Route = createFileRoute("/w/$plugin")({
  component: PluginWindowRoute,
});

/**
 * 插件独立窗口通用路由：渲染插件注册的 windowComponent（无边框窗口
 * 时由窗口组件自绘标题栏）。由插件后端经宿主 create_window 打开。
 */
function PluginWindowRoute() {
  const { plugin } = Route.useParams();
  useSyncExternalStore(featureRegistry.subscribe, featureRegistry.getVersion);
  useSyncExternalStore(pluginRuntime.subscribe, pluginRuntime.getState);

  const component = featureRegistry.get(plugin)?.windowComponent;
  if (component) {
    const Window = component;
    return <Window />;
  }
  if (pluginRuntime.getState() === "ready") {
    return <ComingSoon />;
  }
  return <PageLoading label="窗口加载中" />;
}
