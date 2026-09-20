/** 读取图片 data URL 的像素尺寸；解析失败时回退为 1x1 */
export function imageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || 1;
      const height = img.naturalHeight || 1;
      resolve({ width, height });
    };
    img.onerror = () => resolve({ width: 1, height: 1 });
    img.src = dataUrl;
  });
}
