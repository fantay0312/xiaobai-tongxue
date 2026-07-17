import type { ImageAttachment } from '../types';

export const IMAGE_INPUT_ACCEPT = 'image/jpeg,image/png,image/webp';

const SOURCE_MAX_BYTES = 20 * 1024 * 1024;
const OUTPUT_MAX_BYTES = 6 * 1024 * 1024;
const SOURCE_MAX_PIXELS = 36_000_000;
const OUTPUT_MAX_EDGE = 1_800;
const JPEG_QUALITIES = [0.86, 0.74, 0.62, 0.5] as const;

type SupportedSourceMime = 'image/jpeg' | 'image/png' | 'image/webp';

export interface PreparedImageAttachment {
  blob: Blob;
  attachment: ImageAttachment;
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

function normalizedMime(mime: string): string {
  const value = mime.toLowerCase().split(';', 1)[0].trim();
  return value === 'image/jpg' ? 'image/jpeg' : value;
}

async function sniffMime(file: Blob): Promise<SupportedSourceMime | null> {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e
    && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a
    && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return 'image/png';
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP' ? 'image/webp' : null;
}

async function decodeWithImageElement(file: Blob): Promise<DecodedImage> {
  const sourceUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';
  image.src = sourceUrl;
  try {
    await image.decode();
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(sourceUrl),
    };
  } catch {
    URL.revokeObjectURL(sourceUrl);
    throw new Error('image-decode');
  }
}

async function decodeImage(file: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap !== 'function') return decodeWithImageElement(file);
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  } catch {
    return decodeWithImageElement(file);
  }
}

function outputSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, OUTPUT_MAX_EDGE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('image-encode')),
      'image/jpeg',
      quality,
    );
  });
}

async function encodeCanvas(canvas: HTMLCanvasElement): Promise<Blob> {
  let last: Blob | null = null;
  for (const quality of JPEG_QUALITIES) {
    last = await canvasToJpeg(canvas, quality);
    if (last.size <= OUTPUT_MAX_BYTES) return last;
  }
  throw new Error(last ? 'image-output-too-large' : 'image-encode');
}

function drawImage(decoded: DecodedImage): { canvas: HTMLCanvasElement; width: number; height: number } {
  const { width, height } = outputSize(decoded.width, decoded.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('image-canvas');
  context.fillStyle = 'rgb(255 255 255)';
  context.fillRect(0, 0, width, height);
  context.drawImage(decoded.source, 0, 0, width, height);
  return { canvas, width, height };
}

/**
 * 解码后重画到 Canvas：限制像素与上传体积，同时不带原图 EXIF/GPS 元数据。
 */
export async function prepareImageAttachment(file: File): Promise<PreparedImageAttachment> {
  if (file.size <= 0) throw new Error('image-empty');
  if (file.size > SOURCE_MAX_BYTES) throw new Error('image-source-too-large');
  const detectedMime = await sniffMime(file);
  const declaredMime = normalizedMime(file.type);
  if (!detectedMime || (declaredMime && declaredMime !== detectedMime)) throw new Error('image-type');

  const decoded = await decodeImage(file);
  try {
    if (decoded.width <= 0 || decoded.height <= 0) throw new Error('image-decode');
    if (decoded.width * decoded.height > SOURCE_MAX_PIXELS) throw new Error('image-pixels');
    const { canvas, width, height } = drawImage(decoded);
    const blob = await encodeCanvas(canvas);
    return {
      blob,
      attachment: {
        objectUrl: URL.createObjectURL(blob),
        mimeType: 'image/jpeg',
        width,
        height,
        byteSize: blob.size,
      },
    };
  } finally {
    decoded.close();
  }
}

export function revokeImageAttachment(image: PreparedImageAttachment | ImageAttachment): void {
  const attachment = 'attachment' in image ? image.attachment : image;
  URL.revokeObjectURL(attachment.objectUrl);
}

export function imageAttachmentErrorHint(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'image-source-too-large') return '图片超过 20MB，请换一张小些的';
  if (code === 'image-pixels') return '图片像素太高，请先裁剪或缩小后再发';
  if (code === 'image-type') return '只能发 JPEG、PNG 或 WebP 图片';
  if (code === 'image-empty') return '这张图是空的，请重新选择';
  return '这张图没能读取，请换一张再试';
}
