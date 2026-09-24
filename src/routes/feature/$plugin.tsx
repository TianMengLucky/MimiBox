import { useSyncExternalStore } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { featureRegistry } from "../../core/registry";
import { pluginRuntime } from "../../core/runtime";
import ComingSoon from "@components/screen/ComingSoon";
import { PageLoading } from "@components/screen/PageLoading";

export const Route = createFileRoute("/feature/$plugin")({
  component: PluginFeatureRoute,
});

/**
 * 通用插件功能页：按路由参数从功能注册表取插件注册的页面组件渲染，
 * 外层布局壳（返回按钮 + 面板）由 /feature 底层路由提供。
 * 插件尚未注册时显示加载占位；运行时就绪仍无此插件则显示占位页。
 */
function PluginFeatureRoute() {
  const { plugin } = Route.useParams();
  // 订阅注册表与运行时状态：插件异步加载完成后自动切换到功能组件
  useSyncExternalStore(featureRegistry.subscribe, featureRegistry.getVersion);
  useSyncExternalStore(pluginRuntime.subscribe, pluginRuntime.getState);

  const component = featureRegistry.get(plugin)?.component;
  if (component) {
    const Feature = component;
    return <Feature />;
  }
  if (pluginRuntime.getState() === "ready") {
    return <ComingSoon />;
  }
  return <PageLoading label="功能加载中" />;
}
