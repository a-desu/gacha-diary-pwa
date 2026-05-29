import { useEffect, useState } from "react";
import { gachaRepository } from "../repositories/gachaRepository";

export function useImageUrl(imageId?: string) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;
    let objectUrl = "";

    async function loadImage() {
      if (!imageId) {
        setUrl("");
        return;
      }

      try {
        const image = await gachaRepository.getImage(imageId);
        if (!image || disposed) return;
        objectUrl = URL.createObjectURL(image.blob);
        setUrl(objectUrl);
        setError("");
      } catch {
        if (!disposed) setError("画像を読み込めませんでした。");
      }
    }

    loadImage();

    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imageId]);

  return { url, error };
}
