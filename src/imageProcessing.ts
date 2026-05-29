import type { ImageData, PendingImage } from "./types";

const MAX_IMAGE_EDGE = 1280;
const JPEG_QUALITY = 0.75;

export function createId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function compressImage(file: File): Promise<Blob> {
  const image = await loadImage(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("画像を処理できませんでした。");
  context.drawImage(image, 0, 0, width, height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("画像をJPEGに変換できませんでした。"));
      },
      "image/jpeg",
      JPEG_QUALITY
    );
  });
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("画像を読み込めませんでした。"));
    };
    image.src = url;
  });
}

export async function createPendingImages(files: FileList | File[]) {
  const images: PendingImage[] = [];

  for (const file of Array.from(files)) {
    if (!file.type.startsWith("image/")) continue;
    const blob = await compressImage(file);
    images.push({
      id: createId(),
      blob,
      previewUrl: URL.createObjectURL(blob),
      createdAt: Date.now()
    });
  }

  return images;
}

export function pendingToStoredImage(image: PendingImage, itemId: string): ImageData {
  return {
    id: image.id,
    itemId,
    blob: image.blob,
    createdAt: image.createdAt
  };
}
