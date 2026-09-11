import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@heroui/react";
import { Icon } from "@iconify/react";
import { createFileRoute } from "@tanstack/react-router";
import { Die } from "@components/bobing/Die";
import { HistoryPanel } from "@components/bobing/HistoryPanel";
import { BOBING_RANKS, evaluateDice } from "@components/bobing/rules";
import type { BobingRank } from "@components/bobing/rules";
import { loadBobingData, saveBobingData } from "@components/bobing/store";
import type { BobingData } from "@components/bobing/types";

export const Route = createFileRoute("/feature/bobing")({
  component: BobingRoute,
});

const DICE_COUNT = 6;
/** 掷骰动画时长 */
const ROLL_DURATION_MS = 900;
/** 动画中骰面轮换间隔 */
const ROLL_TICK_MS = 80;
/** bobing.json 最多保留的历史条数 */
const MAX_HISTORY = 200;
/** 状元级彩头（前三档），出结果时给点彩蛋 */
const TOP_RANK_IDS = new Set(["jinhua", "wuzi", "zhuangyuan"]);

const randomFace = () => Math.floor(Math.random() * 6) + 1;
const randomDice = () => Array.from({ length: DICE_COUNT }, randomFace);

function BobingRoute() {
  const [data, setData] = useState<BobingData | null>(null);
  const [dice, setDice] = useState<number[]>(() => randomDice());
  const [rolling, setRolling] = useState(false);
  const [rank, setRank] = useState<BobingRank | null>(null);
  const tickTimerRef = useRef<number | undefined>(undefined);
  const stopTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    loadBobingData().then((loaded) => {
      if (!cancelled) setData(loaded);
    });
    return () => {
      cancelled = true;
      window.clearInterval(tickTimerRef.current);
      window.clearTimeout(stopTimerRef.current);
    };
  }, []);

  /** 统一的数据更新入口：改内存的同时整体写盘 */
  const update = useCallback((fn: (prev: BobingData) => BobingData) => {
    setData((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      saveBobingData(next).catch((err) => console.error("保存博饼数据失败", err));
      return next;
    });
  }, []);

  /** 亮出结果并写入历史 */
  const settle = useCallback(
    (finalDice: number[]) => {
      const result = evaluateDice(finalDice);
      setRank(result);
      update((prev) => ({
        history: [
          {
            id: crypto.randomUUID(),
            dice: finalDice,
            rankId: result.id,
            rankName: result.name,
            time: Date.now(),
          },
          ...prev.history,
        ].slice(0, MAX_HISTORY),
      }));
    },
    [update],
  );

  const handleRoll = () => {
    if (rolling) return;
    setRank(null);
    const finalDice = randomDice();
    // 减弱动态效果时跳过翻滚动画，直接出结果
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDice(finalDice);
      settle(finalDice);
      return;
    }
    setRolling(true);
    tickTimerRef.current = window.setInterval(() => setDice(randomDice()), ROLL_TICK_MS);
    stopTimerRef.current = window.setTimeout(() => {
      window.clearInterval(tickTimerRef.current);
      setRolling(false);
      setDice(finalDice);
      settle(finalDice);
    }, ROLL_DURATION_MS);
  };

  if (!data) {
    return null;
  }

  return (
    // flex-1 填满面板；不用 min-h-0，空间不足时保持自然高度让面板滚动，
    // 避免居中布局向上下溢出压到标题和底部区域；
    // 各区块尺寸随面板宽高（cqw/cqh）收缩，默认 800x600 及以上无需页面滚动
    <div className="bobing-page flex flex-1 flex-col">
      <header>
        <h1 className="bobing-title m-0 font-extrabold tracking-tight text-[#66535a]">博饼</h1>
        <p className="bobing-subtitle m-0 text-center text-[#9b8a91]" style={{ marginTop: "0.25em" }}>
          闽南中秋掷骰游戏：一点、四点为红，红四越多彩头越大。
        </p>
      </header>

      {/* 骰碗与掷骰控制：并排布局，控制列在骰碗右侧且垂直居中对齐 */}
      <div className="flex flex-1 items-center justify-center">
        <div className="bobing-hero">
          <div
            role="img"
            aria-label={`骰子点数：${dice.join("、")}`}
            className="bobing-bowl flex items-center justify-center border border-white/60 bg-gradient-to-b from-[#fff1f7] to-[#ffe4f0] shadow-inner"
          >
            {dice.map((face, index) => (
              <Die key={index} value={face} rolling={rolling} />
            ))}
          </div>

          <div className="bobing-controls flex min-w-0 max-w-full flex-col gap-1">
            <Button className="bobing-roll-btn" onPress={handleRoll} isDisabled={rolling}>
              <Icon icon="lucide:dices" width="20" height="20" aria-hidden="true" />
              {rolling ? "投骰中…" : "投骰"}
            </Button>
            <p aria-live="polite" className="bobing-row m-0 min-h-6">
              {rolling ? (
                <span className="text-[#9b8a91]">碗中翻滚…</span>
              ) : rank ? (
                <>
                  <strong className="bobing-result-name font-extrabold text-[#d26d9a]">
                    {TOP_RANK_IDS.has(rank.id) ? "🎉 " : ""}
                    {rank.name}
                  </strong>
                  <span className="bobing-result-note text-[#9b8a91]"> · {rank.note}</span>
                </>
              ) : (
                <span className="text-[#9b8a91]">点击按钮掷骰，看看手气如何</span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* 彩头速查与历史并排铺满底部宽度；芯片列更宽以减少换行行数 */}
      <div className="grid grid-cols-[1.4fr_1fr] items-start gap-3">
        <section aria-label="彩头等级" className="flex flex-col gap-[clamp(4px,0.6cqw,10px)]">
          <h2 className="bobing-heading m-0 font-bold text-[#66535a]">彩头等级</h2>
          <ol className="m-0 flex list-none flex-wrap gap-[clamp(3px,0.45cqw,8px)] p-0">
            {BOBING_RANKS.map((item, index) => (
              <li
                key={item.id}
                className="bobing-chip flex items-baseline gap-[0.35em] rounded-lg border border-white/60 bg-white/45 px-[0.55em] py-[0.25em]"
              >
                <span className="font-semibold text-[#66535a]">{item.name}</span>
                <span className="text-[#9b8a91]">{item.note}</span>
                <span className="sr-only">（第 {index + 1} 高）</span>
              </li>
            ))}
          </ol>
        </section>

        <HistoryPanel
          entries={data.history}
          onClear={() => update((prev) => ({ ...prev, history: [] }))}
        />
      </div>
    </div>
  );
}
