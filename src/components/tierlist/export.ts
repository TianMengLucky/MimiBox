import { exportTierListImageFile } from "./store";
import type { TierListScheme } from "./types";

/** 导出图版式常量 */
const PAGE_PAD = 20;
const ROW_GAP = 10;
const ROW_PAD = 8;
const LABEL_W = 96;
const CELL = 64;
const GAP = 8;
const CONTENT_W = 600;
const CANVAS_W = PAGE_PAD * 2 + LABEL_W + 12 + CONTENT_W;
const PER_ROW = Math.floor((CONTENT_W + GAP) / (CELL + GAP));
const FONT_STACK = '"Segoe UI", "Microsoft YaHei", sans-serif';

/** 画圆角矩形路径（WebView2 支持 roundRect，这里手写以保持兼容） */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** 按方案把梯队画成一张排名图 PNG，交给 Rust 保存到 exports/ 并返回文件路径 */
export async function exportTierListImage(scheme: TierListScheme): Promise<string> {
  const imageMap = new Map<string, HTMLImageElement | null>();
  await Promise.all(
    scheme.tiers.flatMap((tier) =>
      tier.items.map(async (item) => {
        if (!imageMap.has(item.id)) {
          imageMap.set(item.id, await loadImage(item.image));
        }
      }),
    ),
  );

  const rows = scheme.tiers.map((tier) => {
    const lines = Math.max(1, Math.ceil(tier.items.length / PER_ROW));
    return {
      tier,
      height: Math.max(80, ROW_PAD * 2 + lines * (CELL + GAP) - GAP),
    };
  });
  const canvasH =
    PAGE_PAD * 2 + rows.reduce((sum, row) => sum + row.height + ROW_GAP, 0) - ROW_GAP;

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("无法创建画布");
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CANVAS_W, canvasH);

  let y = PAGE_PAD;
  for (const { tier, height } of rows) {
    ctx.fillStyle = "#f8f4f6";
    roundRectPath(ctx, PAGE_PAD, y, CANVAS_W - PAGE_PAD * 2, height, 12);
    ctx.fill();

    ctx.fillStyle = tier.color;
    roundRectPath(ctx, PAGE_PAD + 4, y + 4, LABEL_W, height - 8, 10);
    ctx.fill();
    // 白色（“拉”行）等浅色标签块在浅色画布上加细描边保证可见
    ctx.strokeStyle = "rgba(0, 0, 0, 0.08)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // 梯队名：颜色对齐参考站近黑文字，字号按字数递减
    const label = tier.name || "未命名";
    let fontSize = label.length >= 3 ? 13 : label.length === 2 ? 20 : 24;
    ctx.font = `bold ${fontSize}px ${FONT_STACK}`;
    while (fontSize > 11 && ctx.measureText(label).width > LABEL_W - 16) {
      fontSize -= 1;
      ctx.font = `bold ${fontSize}px ${FONT_STACK}`;
    }
    ctx.fillStyle = "#262626";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, PAGE_PAD + 4 + LABEL_W / 2, y + height / 2);

    if (tier.items.length === 0) {
      ctx.fillStyle = "#b7a4ac";
      ctx.font = `12px ${FONT_STACK}`;
      ctx.textAlign = "left";
      ctx.fillText("（空）", PAGE_PAD + LABEL_W + 16, y + height / 2);
    }

    tier.items.forEach((item, index) => {
      const col = index % PER_ROW;
      const row = Math.floor(index / PER_ROW);
      const x = PAGE_PAD + LABEL_W + 12 + col * (CELL + GAP);
      const iy = y + ROW_PAD + row * (CELL + GAP);
      const img = imageMap.get(item.id);
      if (!img) {
        ctx.fillStyle = "#e7d5dd";
        roundRectPath(ctx, x, iy, CELL, CELL, 10);
        ctx.fill();
        return;
      }
      ctx.save();
      roundRectPath(ctx, x, iy, CELL, CELL, 10);
      ctx.clip();
      // cover 裁剪：撑满方块并居中
      const scale = Math.max(CELL / img.width, CELL / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, x + (CELL - w) / 2, iy + (CELL - h) / 2, w, h);
      ctx.restore();
    });

    y += height + ROW_GAP;
  }

  return exportTierListImageFile(scheme.name || "排名表", canvas.toDataURL("image/png"));
}
