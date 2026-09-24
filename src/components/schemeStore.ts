import { useCallback, useEffect, useState } from "react";

import { tauriInvoke } from "../lib/tauriInvoke";
import { mergeSchemes } from "./schemeTransfer/io";

/** 方案数据命令调用实现：宿主页用缺省的 tauriInvoke，
 *  插件页传入 MbPluginContext.invoke（经网关限定插件名）。 */
export type SchemeInvoke = (
  command: string,
  args?: Record<string, unknown>,
  options?: { defaultValue?: unknown },
) => Promise<unknown>;

/**
 * 各功能模块方案数据（<功能>.json）的通用读写包装：
 * 读取失败（如纯浏览器预览、数据被手动改坏）时降级为空数据，不阻塞页面渲染。
 * 插件后端对应各插件 Registry 的 <功能>_load/<功能>_save 命令。
 */
export function createSchemeStore<T>(config: {
  /** 应用数据目录下的文件名，仅用于日志标识 */
  file: string;
  /** 后端读取命令名 */
  loadCommand: string;
  /** 后端整体保存命令名 */
  saveCommand: string;
  /** 读取失败时降级返回的空数据 */
  empty: () => T;
  /** 命令调用实现；缺省用全局 tauriInvoke */
  invoke?: SchemeInvoke;
}) {
  const call = config.invoke ?? ((command, args, options) => tauriInvoke(command, args, options));

  async function load(): Promise<T> {
    try {
      // 浏览器开发预览时返回空数据，不依赖 Tauri
      const data = await call(config.loadCommand, undefined, {
        defaultValue: config.empty(),
      });
      return data as T;
    } catch (err) {
      console.error(`读取${config.file}失败`, err);
      return config.empty();
    }
  }

  function save(data: T): Promise<void> {
    return call(config.saveCommand, { data }) as Promise<void>;
  }

  return { load, save };
}

/** 方案类功能数据的公共形状（rating/tierlist/lottery/prediction 一致） */
type SchemeDataBase<TScheme extends { id: string; name: string }> = {
  schemes: TScheme[];
  activeSchemeId: string | null;
};

/**
 * 方案类功能页的公共状态机：加载 → 规整 → 更新写盘 → 活动方案派生 →
 * 切换/新建/删除/导入的统一处理器。页面只保留各自的领域规整与业务逻辑。
 */
export function useSchemeData<
  TData extends SchemeDataBase<TScheme>,
  TScheme extends { id: string; name: string },
>(config: {
  load: () => Promise<TData>;
  save: (data: TData) => Promise<void>;
  /** 保存失败日志前缀，如「保存评分数据失败」 */
  logLabel: string;
  /** 页面级领域规整（如席位修复）；公共的“至少一个方案”规整在其后自动执行 */
  normalize?: (data: TData) => TData;
  /** 空数据兜底方案（「默认方案」） */
  makeDefaultScheme: () => TScheme;
}) {
  const { load, save, logLabel, makeDefaultScheme } = config;
  const [data, setData] = useState<TData | null>(null);

  useEffect(() => {
    let cancelled = false;
    const normalize = config.normalize ?? ((loaded: TData) => loaded);
    load().then((loaded) => {
      if (cancelled) return;
      const base = normalize(loaded);
      // 公共规整：至少一个方案，且活动方案指向存在的方案
      if (base.schemes.length === 0) {
        const scheme = makeDefaultScheme();
        setData({ ...base, schemes: [scheme], activeSchemeId: scheme.id });
      } else if (!base.schemes.some((s) => s.id === base.activeSchemeId)) {
        setData({ ...base, activeSchemeId: base.schemes[0].id });
      } else {
        setData(base);
      }
    });
    return () => {
      cancelled = true;
    };
    // 仅在挂载时加载一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 统一的数据更新入口：改内存的同时整体写盘 */
  const update = useCallback(
    (fn: (prev: TData) => TData) => {
      setData((prev) => {
        if (!prev) return prev;
        const next = fn(prev);
        save(next).catch((err) => console.error(logLabel, err));
        return next;
      });
    },
    [save, logLabel],
  );

  const activeScheme = data
    ? (data.schemes.find((s) => s.id === data.activeSchemeId) ?? data.schemes[0])
    : undefined;

  /** 修改当前方案的统一入口 */
  const mutateScheme = useCallback(
    (fn: (scheme: TScheme) => TScheme) => {
      update((prev) => ({
        ...prev,
        schemes: prev.schemes.map((s) => (s.id === prev.activeSchemeId ? fn(s) : s)),
      }));
    },
    [update],
  );

  const selectScheme = useCallback(
    (id: string) => update((prev) => ({ ...prev, activeSchemeId: id })),
    [update],
  );

  /** 追加方案并设为活动（新建共用） */
  const addScheme = useCallback(
    (scheme: TScheme) =>
      update((prev) => ({
        ...prev,
        schemes: [...prev.schemes, scheme],
        activeSchemeId: scheme.id,
      })),
    [update],
  );

  /** 删除当前方案；删光后回退到「默认方案」 */
  const deleteActiveScheme = useCallback(() => {
    update((prev) => {
      const rest = prev.schemes.filter((s) => s.id !== prev.activeSchemeId);
      if (rest.length === 0) {
        const scheme = makeDefaultScheme();
        return { ...prev, schemes: [scheme], activeSchemeId: scheme.id };
      }
      return { ...prev, schemes: rest, activeSchemeId: rest[0].id };
    });
  }, [update, makeDefaultScheme]);

  /** 导入方案：与现有 id 冲突时重新生成 id，不改变活动方案 */
  const importSchemes = useCallback(
    (imported: TScheme[]) => {
      if (imported.length === 0) return;
      update((prev) => ({
        ...prev,
        schemes: [...prev.schemes, ...mergeSchemes(prev.schemes, imported)],
      }));
    },
    [update],
  );

  return {
    data,
    update,
    activeScheme,
    mutateScheme,
    selectScheme,
    addScheme,
    deleteActiveScheme,
    importSchemes,
  };
}
