import type { BobingRankId } from "./types";

export interface BobingRank {
  id: BobingRankId;
  /** 彩头名称 */
  name: string;
  /** 达成条件说明 */
  note: string;
}

/** 彩头等级从高到低（判定时自上而下取第一个命中项） */
export const BOBING_RANKS: BobingRank[] = [
  { id: "jinhua", name: "状元插金花", note: "四个红四 + 两个红一" },
  { id: "wuzi", name: "五子登科", note: "五颗点数相同" },
  { id: "zhuangyuan", name: "状元", note: "四个红四" },
  { id: "duitang", name: "对堂", note: "一至六点各一颗" },
  { id: "sanhong", name: "三红", note: "三个红四" },
  { id: "sijin", name: "四进", note: "四颗点数相同" },
  { id: "erju", name: "二举", note: "两个红四" },
  { id: "yixiu", name: "一秀", note: "一个红四" },
  { id: "none", name: "无名", note: "未中彩头，再来一把" },
];

const RANK_BY_ID = new Map(BOBING_RANKS.map((rank) => [rank.id, rank]));

export function rankById(id: BobingRankId): BobingRank {
  return RANK_BY_ID.get(id) ?? BOBING_RANKS[BOBING_RANKS.length - 1];
}

/** 统计六颗骰子的点数分布 */
function faceCounts(dice: number[]): number[] {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const face of dice) {
    if (face >= 1 && face <= 6) counts[face]++;
  }
  return counts;
}

/** 按闽南博饼传统规则判定六颗骰子的彩头（一点、四点为红） */
export function evaluateDice(dice: number[]): BobingRank {
  const counts = faceCounts(dice);
  const fours = counts[4];

  // 状元插金花：四个红四带两个红一（最高彩头）
  if (fours === 4 && counts[1] === 2) return rankById("jinhua");
  // 五子登科：五颗同点（含五红）
  if (counts.some((count) => count === 5)) return rankById("wuzi");
  // 状元：四个红四
  if (fours === 4) return rankById("zhuangyuan");
  // 对堂：一至六点各一颗
  if (counts.slice(1).every((count) => count === 1)) return rankById("duitang");
  // 三红：三个红四
  if (fours === 3) return rankById("sanhong");
  // 四进：四颗同点（四个红四已在上面按状元判定）
  if (counts.slice(1).some((count) => count === 4)) return rankById("sijin");
  // 二举：两个红四
  if (fours === 2) return rankById("erju");
  // 一秀：一个红四
  if (fours === 1) return rankById("yixiu");
  return rankById("none");
}
