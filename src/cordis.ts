/**
 * Cordis 接入骨架
 *
 * cordis@4（cordiverse/cordis）是 DeepSeek Harness 同源的插件框架
 * （Meta-Framework of Spatiotemporal Composability）。
 * 文档（施工中）：https://deepseek-harness.github.io/deepseek-harness/reference/cordis-primer
 *
 * 当前为最小可运行占位：
 * - 创建应用级根 Context（自带 events / logger / reflect / registry 服务）
 * - 预留插件注册方式，后续接入业务插件或 @cordisjs/plugin-loader
 */
import { Context } from "cordis";

/** 应用级根上下文 */
export const app = new Context();

export type { Context };

/**
 * 注册一个基础插件（示例，可删）：
 * ```ts
 * import { app } from "./cordis";
 * app.registry.plugin(
 *   (ctx) => {
 *     ctx.logger.info("plugin started");
 *     return () => ctx.logger.info("plugin disposed"); // 清理副作用
 *   },
 *   {},
 * );
 * ```
 */

/** 在应用启动时加载核心插件 */
export function loadCorePlugins() {
  app.logger.info("[cordis] context ready");
}
