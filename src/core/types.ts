/** 插件清单与运行时共享类型（与宿主 plugin_list 返回结构对应，camelCase） */

/** 磁盘插件清单（Plugins/<id>/plugin.json + 宿主运行时补充的状态字段） */
export interface MbPluginManifest {
  id: string;
  title: string;
  emoji: string;
  description: string;
  /** 首页卡片分类：插件可自定义任意 key（未登记的类别以声明值作为页签
   * 标签；内置 video=视频制作、fun=娱乐功能），缺省归入 fun */
  category: string;
  /** 依赖的宿主服务（如 "account"） */
  requires: string[];
  /** 是否来自用户导入目录（设置页据此展示「删除」） */
  userInstalled?: boolean;
  /** cordis Fiber 状态：Active（正常）/ Pending（等服务就绪）/ Failed … */
  state: string;
  /** Pending 时缺失的服务名 */
  missing: string[];
  entry: {
    backend: string;
    /** 前端 bundle 路径；空字符串表示纯后端插件 */
    frontend: string;
  };
}
