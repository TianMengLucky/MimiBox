"use no memo";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@heroui/react";
import { Icon } from "@iconify/react";
import type { LotteryPrize } from "./types";

/** 单元格（一格一个奖品）高度；窗口固定显示 3 格，中奖格停在中间行 */
const CELL = 88;
const WINDOW_CELLS = 3;
const REEL_COUNT = 3;
/** 卷轴内容 = 奖品列表重复 2 份，滚动位置按单份高度取模循环 */
const COPIES = 2;
/** 各卷轴开始滚动的错峰间隔与滚动时长，依次落定制造悬念 */
const REEL_STAGGER_MS = 200;
const REEL_DURATIONS = [2200, 3100, 4000];
const MIN_PRIZES = 2;

type SlotProps = {
  prizes: LotteryPrize[];
  /** 抽奖进行中（用于父级禁用编辑等），由组件在起停时上报 */
  onSpinChange?: (spinning: boolean) => void;
  /** 三轴全部落定后回调中奖奖品（与转盘 onEnd 等价） */
  onFinish: (winner: LotteryPrize) => void;
};

/** easeOutQuart：起步全速、末段缓停，接近真机的减速手感 */
function easeOutQuart(t: number) {
  return 1 - Math.pow(1 - t, 4);
}

/**
 * 老虎机抽奖：三卷轴同时下滚、依次停在同一个中奖奖品上。
 * 卷轴渲染两份奖品列表，滚动位置按单份高度取模，实现无限循环滚动。
 */
export function SlotMachine({ prizes, onSpinChange, onFinish }: SlotProps) {
  const [spinning, setSpinning] = useState(false);
  /** 每轴的滚动位置（虚拟值可为负，渲染时取模） */
  const [positions, setPositions] = useState<number[]>(() =>
    Array.from({ length: REEL_COUNT }, () => 0),
  );
  const rafRef = useRef<number | undefined>(undefined);
  const spinningRef = useRef(false);
  const prizesRef = useRef(prizes);
  prizesRef.current = prizes;

  // 奖品列表变化且未在滚动时，重新对齐到合法的静止位置
  useEffect(() => {
    if (spinningRef.current || prizes.length < MIN_PRIZES) return;
    setPositions(Array.from({ length: REEL_COUNT }, () => 0));
  }, [prizes]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  /** 计算让第 index 个奖品停在中间行的取模后位置 */
  const restPosition = useCallback((index: number) => {
    const len = prizesRef.current.length;
    const cycle = len * CELL;
    // (index-1)*CELL 使该格顶部对齐窗口中间行；结果取模到 [0, cycle)
    const raw = (index - 1) * CELL;
    return ((raw % cycle) + cycle) % cycle;
  }, []);

  const handleStart = () => {
    const len = prizesRef.current.length;
    if (spinningRef.current || len < MIN_PRIZES) return;
    const winnerIndex = Math.floor(Math.random() * len);
    const winner = prizesRef.current[winnerIndex];
    spinningRef.current = true;
    setSpinning(true);
    onSpinChange?.(true);

    const settle = () => {
      spinningRef.current = false;
      setSpinning(false);
      onSpinChange?.(false);
      onFinish(winner);
    };

    // 减弱动态效果时直接落定，尽快出结果
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const targets = Array.from({ length: REEL_COUNT }, () => restPosition(winnerIndex));
      setPositions(targets);
      window.setTimeout(settle, 200);
      return;
    }

    const starts = positions.slice();
    const targets = Array.from({ length: REEL_COUNT }, () => restPosition(winnerIndex));
    const cycle = len * CELL;
    // 各轴向下滚动的总距离：至少 3 整圈 + 对齐到目标位置的差值；
    // 只能加整圈数（cycle 的整数倍），否则取模后会停在错误的奖品上
    const distances = targets.map((target, i) => {
      let delta = starts[i] - target;
      while (delta < cycle * 3) delta += cycle;
      delta += Math.floor(Math.random() * 2) * cycle;
      return delta;
    });
    const beganAt = performance.now();
    const totalMs =
      REEL_STAGGER_MS * (REEL_COUNT - 1) + REEL_DURATIONS[REEL_DURATIONS.length - 1] + 100;

    const tick = (now: number) => {
      const elapsed = now - beganAt;
      const next = Array.from({ length: REEL_COUNT }, (_, i) => {
        const progress = Math.min(
          1,
          Math.max(0, (elapsed - i * REEL_STAGGER_MS) / REEL_DURATIONS[i]),
        );
        return starts[i] - distances[i] * easeOutQuart(progress);
      });
      setPositions(next);
      if (elapsed < totalMs) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = undefined;
        setPositions(targets);
        settle();
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  if (prizes.length < MIN_PRIZES) {
    return (
      <div className="flex h-[300px] w-[300px] flex-col items-center justify-center self-center rounded-3xl border-2 border-dashed border-[#e7d5dd] bg-white/50 text-center text-sm text-[#9b8a91]">
        在右侧添加至少 {MIN_PRIZES} 个奖品
        <br />
        才能开始老虎机抽奖
      </div>
    );
  }

  return (
    <div className="flex w-[300px] flex-col items-center gap-3 self-center">
      <div
        className="flex gap-2 rounded-3xl border border-white/55 bg-gradient-to-b from-[#fbdcea] to-[#f7cfdf] p-3 shadow-[0_8px_30px_rgb(133_77_96/18%)]"
        role="img"
        aria-label="老虎机卷轴"
      >
        {Array.from({ length: REEL_COUNT }, (_, reel) => {
          const cycle = prizes.length * CELL;
          // 渲染位置取模到 [0, 单份高度)，两份内容保证窗口始终被覆盖
          const renderPos = ((positions[reel] % cycle) + cycle) % cycle;
          return (
            <div
              key={reel}
              className="relative overflow-hidden rounded-2xl border border-white/70 bg-[#fff6fa] shadow-[inset_0_10px_16px_rgb(133_77_96/12%),inset_0_-10px_16px_rgb(133_77_96/12%)]"
              style={{ width: CELL, height: CELL * WINDOW_CELLS }}
            >
              <div
                className="will-change-transform"
                style={{ transform: `translateY(${-renderPos}px)` }}
              >
                {Array.from({ length: COPIES }, (_, copy) =>
                  prizes.map((prize) => (
                    <div
                      key={`${copy}-${prize.id}`}
                      className="flex flex-col items-center justify-center gap-1 px-1.5 text-center"
                      style={{ height: CELL }}
                    >
                      {prize.image ? (
                        <img
                          src={prize.image}
                          alt=""
                          className="max-h-14 max-w-full object-contain"
                          draggable={false}
                        />
                      ) : (
                        <Icon
                          icon="lucide:gift"
                          width="24"
                          height="24"
                          aria-hidden="true"
                          className="text-[#e3b6cd]"
                        />
                      )}
                      {prize.name && (
                        <span className="w-full text-[11px] leading-tight font-semibold break-words text-[#66535a]">
                          {prize.name}
                        </span>
                      )}
                    </div>
                  )),
                )}
              </div>
              {/* 中间行指示：细粉线标记中奖行 */}
              <div
                className="pointer-events-none absolute inset-x-0 border-y border-[#f2bfd8]/70"
                style={{ top: CELL, height: CELL }}
              />
              {/* 上下渐隐，营造卷轴圆筒的纵深 */}
              <div className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-[#ffd9e8]/85 to-transparent" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[#ffd9e8]/85 to-transparent" />
            </div>
          );
        })}
      </div>

      <Button
        variant="primary"
        className="rounded-full px-8 font-bold"
        onPress={handleStart}
        isDisabled={spinning}
      >
        <Icon icon="lucide:cherry" width="18" height="18" aria-hidden="true" />
        拉一下
      </Button>
    </div>
  );
}
