/** 图片文件读取与压缩（跨功能共享） */

/** 读取图片文件，等比压缩为最长边不超过 size 的 data URL（共享内核）。
    flattenWhite：JPEG 无透明通道，先铺白底避免透明区域变黑 */
function fileToScaledDataUrl(
  file: File,
  size: number,
  mime: "image/png" | "image/jpeg",
  flattenWhite: boolean,
  quality?: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("解析图片失败"));
      img.onload = () => {
        const scale = Math.min(1, size / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("无法创建画布"));
          return;
        }
        if (flattenWhite) {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL(mime, quality));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

/** 读取用户选择的图片文件，等比压缩为边长不超过 size 的 PNG data URL（奖品图/排名条目图无需原图尺寸） */
export function fileToCompressedImage(file: File, size = 128): Promise<string> {
  return fileToScaledDataUrl(file, size, "image/png", false);
}

/** 读取图片文件，等比压缩为最长边不超过 size 的 JPEG data URL（背景图用：尺寸更大、体积更小） */
export function fileToBackgroundImage(file: File, size = 1024): Promise<string> {
  return fileToScaledDataUrl(file, size, "image/jpeg", true, 0.82);
}
