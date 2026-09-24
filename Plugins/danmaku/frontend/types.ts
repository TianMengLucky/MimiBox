// 弹幕姬前后端共享 DTO（与 Plugins/danmaku/backend/src/lib.rs 的
// serde rename_all = "camelCase" 字段一一对应，字段语义变更时两侧一起改）。

/** 单条直播弹幕（`danmaku-message` 事件载荷） */
export interface DanmakuMessage {
  /** 会话内自增序号（列表 key） */
  id: number;
  uid: number;
  uname: string;
  avatar: string;
  text: string;
  medalName: string | null;
  medalLevel: number | null;
  /** 舰队身份：0=普通 1=总督 2=提督 3=舰长 */
  guard: number;
}

/** 连接状态（`danmaku-status` 事件载荷） */
export interface DanmakuStatus {
  /** connecting / connected / reconnecting / disconnected */
  state: "connecting" | "connected" | "reconnecting" | "disconnected";
  /** 断线原因等补充信息 */
  message: string | null;
  roomId: number | null;
  roomTitle: string | null;
  /** 心跳返回的直播间人气值 */
  viewers: number | null;
}

/** 弹幕窗口/主页挂载时的补发快照 */
export interface DanmakuSnapshot {
  status: DanmakuStatus;
  messages: DanmakuMessage[];
}

/** 连接成功后返回的直播间信息 */
export interface DanmakuRoom {
  roomId: number;
  title: string;
  /** 是否正在直播（未开播也能连弹幕，仅用于提示） */
  liveStatus: boolean;
}

/** 舰队身份徽章文案与配色 */
export const GUARD_BADGES: Record<number, { label: string; className: string } | undefined> = {
  1: { label: "总督", className: "danmaku-guard-governor" },
  2: { label: "提督", className: "danmaku-guard-admiral" },
  3: { label: "舰长", className: "danmaku-guard-captain" },
};

/** 昵称色板：按 uid 稳定取色，柔和的粉紫暖色系 */
const NAME_COLORS = [
  "#f06a9d",
  "#e05a8f",
  "#a86ee8",
  "#7d7ae8",
  "#f0805e",
  "#e8a23c",
  "#5bb5e0",
  "#52b788",
  "#d96aa0",
  "#c17be0",
];

/** 由 uid 稳定散列出昵称颜色 */
export function unameColor(uid: number): string {
  let hash = uid;
  hash = (hash ^ (hash >> 16)) * 0x45d9f3b;
  hash = (hash ^ (hash >> 16)) * 0x45d9f3b;
  hash ^= hash >> 16;
  return NAME_COLORS[Math.abs(hash) % NAME_COLORS.length];
}
