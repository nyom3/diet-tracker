export type ResizedImageDimensions = {
  widthPx: number;
  heightPx: number;
};

export function getResizedImageDimensions(
  widthPx: number,
  heightPx: number,
  maxDimensionPx: number,
): ResizedImageDimensions {
  if (
    !Number.isFinite(widthPx) ||
    !Number.isFinite(heightPx) ||
    widthPx <= 0 ||
    heightPx <= 0 ||
    !Number.isFinite(maxDimensionPx) ||
    maxDimensionPx <= 0
  ) {
    throw new Error('画像サイズを取得できませんでした。');
  }

  const scale = Math.min(1, maxDimensionPx / Math.max(widthPx, heightPx));
  return {
    widthPx: Math.max(1, Math.round(widthPx * scale)),
    heightPx: Math.max(1, Math.round(heightPx * scale)),
  };
}
