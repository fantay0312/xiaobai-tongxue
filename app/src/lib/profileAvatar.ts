const ACCEPTED_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const AVATAR_EXTENSION_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 40_000_000;
const AVATAR_EDGE = 384;

export const PROFILE_AVATAR_ACCEPT = 'image/jpeg,image/png,image/webp';

export class ProfileAvatarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileAvatarError';
  }
}

/** 浏览器偶尔不给本地文件 MIME；仅在 MIME 为空时按白名单扩展名补齐。 */
export function profileAvatarMimeForFile(file: Pick<File, 'name' | 'type'>): string | null {
  const declared = file.type.trim().toLowerCase();
  if (declared === 'image/jpg') return 'image/jpeg';
  if (ACCEPTED_AVATAR_TYPES.has(declared)) return declared;
  if (declared) return null;
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return AVATAR_EXTENSION_TYPES[extension] ?? null;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ProfileAvatarError('图片无法读取，请换一张后重试'));
    };
    image.src = url;
  });
}

/** 头像只接收位图，经 Canvas 居中裁成 WebP 后才落本机存储。 */
export async function prepareProfileAvatar(file: File): Promise<string> {
  if (!profileAvatarMimeForFile(file)) {
    throw new ProfileAvatarError('请选择 JPG、PNG 或 WebP 图片');
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new ProfileAvatarError('图片不能超过 8 MB');
  }

  const image = await loadImage(file);
  if (image.naturalWidth < 64 || image.naturalHeight < 64) {
    throw new ProfileAvatarError('图片尺寸太小，请选择至少 64 × 64 的图片');
  }
  if (image.naturalWidth * image.naturalHeight > MAX_SOURCE_PIXELS) {
    throw new ProfileAvatarError('图片尺寸过大，请先缩小后再试');
  }

  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_EDGE;
  canvas.height = AVATAR_EDGE;
  const context = canvas.getContext('2d');
  if (!context) throw new ProfileAvatarError('当前浏览器无法处理图片');

  const crop = Math.min(image.naturalWidth, image.naturalHeight);
  const sourceX = (image.naturalWidth - crop) / 2;
  const sourceY = (image.naturalHeight - crop) / 2;
  context.drawImage(image, sourceX, sourceY, crop, crop, 0, 0, AVATAR_EDGE, AVATAR_EDGE);
  const dataUrl = canvas.toDataURL('image/webp', 0.84);
  if (!dataUrl.startsWith('data:image/webp')) throw new ProfileAvatarError('当前浏览器无法生成 WebP 头像');
  return dataUrl;
}
