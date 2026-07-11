import type { ImagePayload, InputMode } from './types';
import { getResizedImageDimensions } from './imageSizing';

export const emptyImagePayload: ImagePayload = { base64: '', mimeType: '', widthPx: 0, heightPx: 0 };
export const imageDecodeErrorMessage =
  '画像を読み込めませんでした。別の写真を選ぶか、カメラの解像度を下げてお試しください。';

const maxImageDimensionPx = 1536;
const imageJpegQuality = 0.82;
const maxImageBytes = 1.5 * 1024 * 1024;

type ImageDimensions = {
  widthPx: number;
  heightPx: number;
};

export async function readSelectedImage(inputMode: InputMode, file: File | null, note: string): Promise<ImagePayload> {
  if (inputMode !== 'photo') {
    return emptyImagePayload;
  }

  if (!file) {
    if (!note.trim()) {
      throw new Error('写真またはメモを入力してください。');
    }

    return emptyImagePayload;
  }

  if (!/^image\/(jpeg|png)$/.test(file.type)) {
    throw new Error('JPEGまたはPNGを選択してください。');
  }

  return resizeImageForEstimate(file);
}

// token予約が実消費を上回るよう、送信前に長辺を上限まで縮小してから実寸でtokenを見積もる
// (詳細は gas/OpenAiProvider.gs の tryOpenAiVisionEstimate を参照)。
async function resizeImageForEstimate(file: File): Promise<ImagePayload> {
  const sourceDimensions = await readImageDimensions(file);
  const bitmapOptions = sourceDimensions
    ? getResizeOptions(sourceDimensions)
    : undefined;

  let bitmap: ImageBitmap;
  try {
    bitmap = bitmapOptions ? await createImageBitmap(file, bitmapOptions) : await createImageBitmap(file);
  } catch {
    return resizeImageWithElement(file, sourceDimensions);
  }

  try {
    return renderImageForEstimate(bitmap, { widthPx: bitmap.width, heightPx: bitmap.height });
  } finally {
    bitmap.close();
  }
}

function getResizeOptions(dimensions: ImageDimensions): ImageBitmapOptions {
  const resized = getResizedImageDimensions(dimensions.widthPx, dimensions.heightPx, maxImageDimensionPx);
  return {
    resizeWidth: resized.widthPx,
    resizeHeight: resized.heightPx,
    resizeQuality: 'high',
  };
}

async function resizeImageWithElement(file: File, sourceDimensions: ImageDimensions | null): Promise<ImagePayload> {
  let loadedImage: HTMLImageElement;
  let objectUrl: string;

  try {
    ({ image: loadedImage, objectUrl } = await loadImageElement(file));
  } catch {
    throw new Error(imageDecodeErrorMessage);
  }

  try {
    const dimensions = sourceDimensions ?? {
      widthPx: loadedImage.naturalWidth,
      heightPx: loadedImage.naturalHeight,
    };
    return renderImageForEstimate(loadedImage, dimensions);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImageElement(file: File): Promise<{ image: HTMLImageElement; objectUrl: string }> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ image, objectUrl });
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(imageDecodeErrorMessage));
    };
    image.src = objectUrl;
  });
}

async function renderImageForEstimate(
  source: CanvasImageSource,
  sourceDimensions: ImageDimensions,
): Promise<ImagePayload> {
  const { widthPx, heightPx } = getResizedImageDimensions(
    sourceDimensions.widthPx,
    sourceDimensions.heightPx,
    maxImageDimensionPx,
  );
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('画像を処理できませんでした。');
  }

  context.drawImage(source, 0, 0, widthPx, heightPx);

  let quality = imageJpegQuality;
  let blob = await canvasToJpegBlob(canvas, quality);

  while (blob.size > maxImageBytes && quality > 0.4) {
    quality -= 0.12;
    blob = await canvasToJpegBlob(canvas, quality);
  }

  const base64 = await blobToBase64(blob);
  return { base64, mimeType: 'image/jpeg', widthPx, heightPx };
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('画像の変換に失敗しました。'));
        }
      },
      'image/jpeg',
      quality,
    );
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]+;base64,/, ''));
    reader.onerror = () => reject(new Error('画像を読み取れませんでした。'));
    reader.readAsDataURL(blob);
  });
}

async function readImageDimensions(file: File): Promise<ImageDimensions | null> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (file.type === 'image/png') {
      return readPngDimensions(bytes);
    }
    return readJpegDimensions(bytes);
  } catch {
    return null;
  }
}

function readPngDimensions(bytes: Uint8Array): ImageDimensions | null {
  const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24 || !pngSignature.every((value, index) => bytes[index] === value)) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const widthPx = view.getUint32(16);
  const heightPx = view.getUint32(20);
  return widthPx > 0 && heightPx > 0 ? { widthPx, heightPx } : null;
}

function readJpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      return null;
    }

    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;

    if (marker === 0xd9 || marker === 0xda) {
      return null;
    }

    if ((marker >= 0xd0 && marker <= 0xd8) || marker === 0x01) {
      continue;
    }

    if (offset + 1 >= bytes.length) {
      return null;
    }

    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      return null;
    }

    if (isJpegStartOfFrame(marker) && segmentLength >= 7) {
      const heightPx = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const widthPx = (bytes[offset + 5] << 8) | bytes[offset + 6];
      return widthPx > 0 && heightPx > 0 ? { widthPx, heightPx } : null;
    }

    offset += segmentLength;
  }

  return null;
}

function isJpegStartOfFrame(marker: number): boolean {
  return (
    marker === 0xc0 ||
    marker === 0xc1 ||
    marker === 0xc2 ||
    marker === 0xc3 ||
    marker === 0xc5 ||
    marker === 0xc6 ||
    marker === 0xc7 ||
    marker === 0xc9 ||
    marker === 0xca ||
    marker === 0xcb ||
    marker === 0xcd ||
    marker === 0xce ||
    marker === 0xcf
  );
}
