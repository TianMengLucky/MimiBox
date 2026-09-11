"use no memo";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { LuckyWheel } from "@lucky-canvas/react";
import type { LuckyButton, LuckyPrize } from "@lucky-canvas/react";
import { createFileRoute } from "@tanstack/react-router";
import { Icon } from "@iconify/react";
import { HistoryPanel } from "@components/lottery/HistoryPanel";
import { PrizeEditor } from "@components/lottery/PrizeEditor";
import { SchemeBar } from "@components/SchemeBar";
import { loadLotteryData, saveLotteryData } from "@components/lottery/store";
import type {
  LotteryData,
  LotteryPrize,
  LotteryScheme,
} from "@components/lottery/types";

export const Route = createFileRoute("/feature/lottery")({
  component: LotteryRoute,
});

/** 转盘尺寸（编辑区与转盘在窄屏下会上下堆叠） */
const WHEEL_SIZE = 300;
/** 抽奖动画前的匀速旋转时长 */
const SPIN_DELAY_MS = 2600;
/** 历史记录最多保留条数，避免 lottery.json 无限膨胀 */
const MAX_HISTORY = 200;
/** 转盘至少要 2 个奖品才有意义 */
const MIN_PRIZES = 2;

const SECTOR_BG_A = "#fff1f7";
const SECTOR_BG_B = "#ffe4f0";
const TEXT_COLOR = "#66535a";

const DEFAULT_PRIZE_NAMES = [
  "谢谢参与",
  "再来一次",
  "小红花 ✿",
  "奶茶一杯",
  "神秘大奖",
  "谢谢参与",
];

const makeDefaultPrizes = (): LotteryPrize[] =>
  DEFAULT_PRIZE_NAMES.map((name) => ({
    id: crypto.randomUUID(),
    name,
    image: null,
  }));

const makeScheme = (name: string, prizes?: LotteryPrize[]): LotteryScheme => ({
  id: crypto.randomUUID(),
  name,
  prizes: prizes ?? makeDefaultPrizes(),
});

/** 保证数据可用：至少一个方案，且活动方案指向存在的方案 */
function normalize(data: LotteryData): LotteryData {
  if (data.schemes.length === 0) {
    const scheme = makeScheme("默认方案");
    return { schemes: [scheme], activeSchemeId: scheme.id, history: data.history };
  }
  if (!data.schemes.some((s) => s.id === data.activeSchemeId)) {
    return { ...data, activeSchemeId: data.schemes[0].id };
  }
  return data;
}

function LotteryRoute() {
  const [data, setData] = useState<LotteryData | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<LotteryPrize | null>(null);
  /** 转盘扇区悬停提示（canvas 无 DOM，命中检测结果） */
  const [hoverPrize, setHoverPrize] = useState<{
    prize: LotteryPrize;
    x: number;
    y: number;
    below: boolean;
  } | null>(null);
  const wheelRef = useRef<LuckyWheel | null>(null);
  const stopIndexRef = useRef(0);
  const spinTimerRef = useRef<number | undefined>(undefined);
  const wheelBoxRef = useRef<HTMLDivElement | null>(null);
  /** 临时诊断读数（仅开发环境显示）：视口 / DPR / canvas 视觉与布局尺寸 */
  const [debugInfo, setDebugInfo] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadLotteryData().then((loaded) => {
      if (!cancelled) setData(normalize(loaded));
    });
    return () => {
      cancelled = true;
      window.clearTimeout(spinTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const measure = () => {
      const canvas = wheelBoxRef.current?.querySelector("canvas");
      if (!canvas) {
        setDebugInfo("canvas 未挂载");
        return;
      }
      const r = canvas.getBoundingClientRect();
      setDebugInfo(
        `视口 ${window.innerWidth}×${window.innerHeight} · DPR ${window.devicePixelRatio} · ` +
          `canvas 视觉 ${Math.round(r.width)}×${Math.round(r.height)} · 布局 ${canvas.offsetWidth}×${canvas.offsetHeight}`,
      );
    };
    measure();
    const timer = window.setTimeout(measure, 500);
    window.addEventListener("resize", measure);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", measure);
    };
  }, [data, spinning]);

  /** 统一的数据更新入口：改内存的同时整体写盘 */
  const update = useCallback((fn: (prev: LotteryData) => LotteryData) => {
    setData((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      saveLotteryData(next).catch((err) => console.error("保存抽奖数据失败", err));
      return next;
    });
  }, []);

  const activeScheme = data
    ? (data.schemes.find((s) => s.id === data.activeSchemeId) ?? data.schemes[0])
    : undefined;
  const prizes = activeScheme?.prizes ?? [];
  const canDraw = prizes.length >= MIN_PRIZES && !spinning;

  /** 扇区越多字号越小，避免文字挤没了 */
  const wheelFontSize = useMemo(() => {
    const count = prizes.length;
    if (count > 20) return "10px";
    if (count > 12) return "11px";
    return "13px";
  }, [prizes.length]);

  /** 转盘扇区：有图则上图，无名字时只展示图片；名字过长截断（完整信息见悬停提示） */
  const wheelPrizes = useMemo<LuckyPrize[]>(
    () =>
      prizes.map((prize, index) => ({
        title: prize.name,
        background: index % 2 === 0 ? SECTOR_BG_A : SECTOR_BG_B,
        fonts: prize.name
          ? [
              {
                text: prize.name.length > 8 ? `${prize.name.slice(0, 8)}…` : prize.name,
                fontColor: TEXT_COLOR,
                fontSize: wheelFontSize,
                top: prize.image ? "58%" : "22%",
              },
            ]
          : undefined,
        imgs: prize.image ? [{ src: prize.image, width: "30%", top: "12%" }] : undefined,
      })),
    [prizes, wheelFontSize],
  );

  const wheelBlocks = useMemo(
    () => [
      { padding: "14px", background: "#f2bfd8" },
      { padding: "5px", background: "#ffffff" },
    ],
    [],
  );

  const wheelButtons = useMemo<LuckyButton[]>(
    () => [
      { radius: "44px", background: "#f2bfd8" },
      { radius: "38px", background: "#ffffff" },
      { radius: "32px", background: "#f9e0ee", pointer: true },
      {
        radius: "27px",
        background: "#d26d9a",
        fonts: [{ text: "开始\n抽奖", fontSize: "13px", fontColor: "#ffffff", top: -17 }],
      },
    ],
    [],
  );

  // 减弱动态效果时跳过加速/减速动画，尽快出结果
  const wheelConfig = useMemo(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    return reduceMotion
      ? { accelerationTime: 0, decelerationTime: 0, stopTime: 0 }
      : { accelerationTime: 3000, decelerationTime: 3000, stopTime: 40 };
  }, []);

  const handleStart = () => {
    if (!canDraw) return;
    setSpinning(true);
    setResult(null);
    wheelRef.current?.play();
    stopIndexRef.current = Math.floor(Math.random() * prizes.length);
    spinTimerRef.current = window.setTimeout(() => {
      wheelRef.current?.stop(stopIndexRef.current);
    }, SPIN_DELAY_MS);
  };

  const handleEnd = () => {
    setSpinning(false);
    const winner = prizes[stopIndexRef.current];
    if (!winner || !activeScheme) return;
    setResult(winner);
    update((prev) => ({
      ...prev,
      history: [
        {
          id: crypto.randomUUID(),
          schemeId: activeScheme.id,
          schemeName: activeScheme.name,
          prizeId: winner.id,
          prizeName: winner.name || "（图片奖品）",
          time: Date.now(),
        },
        ...prev.history,
      ].slice(0, MAX_HISTORY),
    }));
  };

  /** 扇区悬停命中检测：canvas 无 DOM，按鼠标相对圆心的角度换算奖品索引。
      lucky-canvas 的扇区从 12 点方向起顺时针排列，与 atan2(x, -y) 一致 */
  const handleWheelHover = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (spinning || prizes.length < MIN_PRIZES) {
      setHoverPrize(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = event.clientX - rect.left - rect.width / 2;
    const dy = event.clientY - rect.top - rect.height / 2;
    const dist = Math.hypot(dx, dy);
    // 有效区域：装饰环以内、中央按钮以外
    if (dist > rect.width / 2 - 19 || dist < 46) {
      setHoverPrize(null);
      return;
    }
    const step = (Math.PI * 2) / prizes.length;
    const angle = (Math.atan2(dx, -dy) + Math.PI * 2) % (Math.PI * 2);
    const prize = prizes[Math.floor(angle / step)];
    if (!prize) {
      setHoverPrize(null);
      return;
    }
    // 钳制水平位置避免提示框超出转盘被裁剪；靠上时改为显示在鼠标下方
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    const halfWidth = 66;
    setHoverPrize({
      prize,
      x: Math.min(Math.max(cursorX, halfWidth), WHEEL_SIZE - halfWidth),
      y: cursorY,
      below: cursorY < 130,
    });
  };

  if (!data || !activeScheme) {
    return null;
  }

  return (
    <div className="flex flex-col gap-5 min-[850px]:min-h-0 min-[850px]:flex-1">
      <header>
        <h1 className="m-0 text-xl font-extrabold tracking-tight text-[#66535a]">抽奖</h1>
        <p className="m-0 mt-1 text-sm text-[#9b8a91]">
          自定义转盘奖品的名字和图片，支持保存多个方案与查看历史记录。
        </p>
      </header>

      <SchemeBar
        schemes={data.schemes}
        activeId={activeScheme.id}
        disabled={spinning}
        createLabel="新建方案（复制当前奖品）"
        onSelect={(id) => {
          setResult(null);
          update((prev) => ({ ...prev, activeSchemeId: id }));
        }}
        onCreate={() => {
          setResult(null);
          update((prev) => {
            // 新建方案 = 复制当前奖品（另存为），图片一并带入
            const copied = activeScheme.prizes.map((p) => ({
              ...p,
              id: crypto.randomUUID(),
            }));
            const scheme = makeScheme(`方案 ${prev.schemes.length + 1}`, copied);
            return {
              ...prev,
              schemes: [...prev.schemes, scheme],
              activeSchemeId: scheme.id,
            };
          });
        }}
        onDelete={() => {
          setResult(null);
          update((prev) => {
            const rest = prev.schemes.filter((s) => s.id !== prev.activeSchemeId);
            if (rest.length === 0) {
              const scheme = makeScheme("默认方案");
              return { ...prev, schemes: [scheme], activeSchemeId: scheme.id };
            }
            return { ...prev, schemes: rest, activeSchemeId: rest[0].id };
          });
        }}
      />

      {/* 宽面板（视口 ≥850px）：转盘与奖品编辑区并排，行高锁定为剩余高度，列表内部滚动；
          窄面板：单列自然堆叠，整页滚动，不做高度约束（避免行高塌陷导致重叠） */}
      <div className="grid items-start justify-center gap-6 min-[850px]:min-h-0 min-[850px]:flex-1 min-[850px]:items-stretch min-[850px]:grid-cols-[300px_minmax(300px,1fr)] min-[850px]:grid-rows-[minmax(0,1fr)]">
        <div className="flex w-[300px] flex-col gap-4 justify-self-center min-[850px]:min-h-0">
          <div className="flex flex-col items-center gap-2">
            <div
              ref={wheelBoxRef}
              className="relative h-[300px] w-[300px]"
              onMouseMove={handleWheelHover}
              onMouseLeave={() => setHoverPrize(null)}
            >
              {prizes.length >= MIN_PRIZES ? (
                <LuckyWheel
                  ref={wheelRef}
                  width={`${WHEEL_SIZE}px`}
                  height={`${WHEEL_SIZE}px`}
                  blocks={wheelBlocks}
                  prizes={wheelPrizes}
                  buttons={wheelButtons}
                  defaultStyle={{ fontColor: TEXT_COLOR, fontSize: wheelFontSize }}
                  defaultConfig={wheelConfig}
                  onStart={handleStart}
                  onEnd={handleEnd}
                />
              ) : (
                <div
                  className="flex items-center justify-center rounded-full border-2 border-dashed border-[#e7d5dd] bg-white/50 text-center text-sm text-[#9b8a91]"
                  style={{ width: WHEEL_SIZE, height: WHEEL_SIZE }}
                >
                  在右侧添加至少 {MIN_PRIZES} 个奖品
                  <br />
                  才能开始抽奖
                </div>
              )}
              {hoverPrize && !spinning && (
                <div
                  className="pointer-events-none absolute z-20 flex w-[120px] flex-col items-center gap-1 rounded-xl border border-white/60 bg-white/95 px-2 py-1.5 shadow-[0_6px_18px_rgb(133_77_96/24%)]"
                  style={{
                    left: hoverPrize.x,
                    top: hoverPrize.y,
                    transform: hoverPrize.below
                      ? "translate(-50%, 12px)"
                      : "translate(-50%, calc(-100% - 10px))",
                  }}
                >
                  <div className="flex h-24 w-full items-center justify-center overflow-hidden rounded-lg bg-white/80">
                    {hoverPrize.prize.image ? (
                      <img
                        src={hoverPrize.prize.image}
                        alt=""
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : (
                      <Icon
                        icon="lucide:image-off"
                        width="22"
                        height="22"
                        className="text-[#d8c7cf]"
                        aria-hidden="true"
                      />
                    )}
                  </div>
                  <span className="w-full truncate text-center text-xs font-semibold text-[#66535a]">
                    {hoverPrize.prize.name || "未命名奖品（仅图片）"}
                  </span>
                </div>
              )}
            </div>
            <p aria-live="polite" className="m-0 min-h-6 text-center text-sm font-semibold text-[#66535a]">
              {spinning
                ? "转动中…"
                : result
                  ? result.name
                    ? `🎉 抽中了「${result.name}」`
                    : "🎉 抽中了图片奖品！"
                  : canDraw
                    ? "点击转盘中央开始抽奖"
                    : "奖品不足，先去右侧添加吧"}
            </p>
            {import.meta.env.DEV && debugInfo && (
              <p className="m-0 text-center text-[10px] text-[#c9b6bf]">{debugInfo}</p>
            )}
          </div>

          <HistoryPanel
            entries={data.history}
            onClear={() => update((prev) => ({ ...prev, history: [] }))}
          />
        </div>

        <div className="flex min-w-[300px] flex-1 flex-col">
          <PrizeEditor
            prizes={prizes}
            disabled={spinning}
            onChange={(nextPrizes) =>
              update((prev) => ({
                ...prev,
                schemes: prev.schemes.map((s) =>
                  s.id === prev.activeSchemeId ? { ...s, prizes: nextPrizes } : s,
                ),
              }))
            }
          />
        </div>
      </div>
    </div>
  );
}
