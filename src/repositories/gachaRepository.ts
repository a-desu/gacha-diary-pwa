import { DBSchema, IDBPDatabase, openDB } from "idb";
import type { BackupImageData, CapsuleBackup, CapsuleItem, CapsuleSeries, ImageData } from "../types";

type LegacyRecord = {
  id?: string;
  title?: string;
  gameTitle?: string;
  shop?: string;
  date?: string;
  playedAt?: string;
  cost?: number;
  price?: number;
  count?: number;
  memo?: string;
  imageIds?: string[];
  createdAt?: number | string;
  updatedAt?: number | string;
};

type LegacyImage = Partial<ImageData> & {
  recordId?: string;
};

interface CapsuleDb extends DBSchema {
  items: {
    key: string;
    value: CapsuleItem;
    indexes: {
      seriesId: string;
      maker: string;
      obtainedDate: string;
      updatedAt: number;
    };
  };
  series: {
    key: string;
    value: CapsuleSeries;
    indexes: {
      title: string;
      maker: string;
      updatedAt: number;
    };
  };
  images: {
    key: string;
    value: ImageData | LegacyImage;
    indexes: {
      itemId: string;
      createdAt: number;
    };
  };
  records: {
    key: string;
    value: LegacyRecord;
  };
}

const DB_NAME = "gacha-diary-db";
const DB_VERSION = 3;

let databasePromise: Promise<IDBPDatabase<CapsuleDb>> | null = null;
let migrationPromise: Promise<void> | null = null;

export function createId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getDatabase() {
  if (!databasePromise) {
    databasePromise = openDB<CapsuleDb>(DB_NAME, DB_VERSION, {
      upgrade(db, _oldVersion, _newVersion, tx) {
        if (!db.objectStoreNames.contains("items")) {
          const itemStore = db.createObjectStore("items", { keyPath: "id" });
          itemStore.createIndex("seriesId", "seriesId");
          itemStore.createIndex("maker", "maker");
          itemStore.createIndex("obtainedDate", "obtainedDate");
          itemStore.createIndex("updatedAt", "updatedAt");
        }

        if (!db.objectStoreNames.contains("series")) {
          const seriesStore = db.createObjectStore("series", { keyPath: "id" });
          seriesStore.createIndex("title", "title");
          seriesStore.createIndex("maker", "maker");
          seriesStore.createIndex("updatedAt", "updatedAt");
        }

        if (!db.objectStoreNames.contains("images")) {
          const imageStore = db.createObjectStore("images", { keyPath: "id" });
          imageStore.createIndex("itemId", "itemId");
          imageStore.createIndex("createdAt", "createdAt");
        } else {
          const imageStore = tx.objectStore("images");
          if (!imageStore.indexNames.contains("itemId")) imageStore.createIndex("itemId", "itemId");
          if (!imageStore.indexNames.contains("createdAt")) imageStore.createIndex("createdAt", "createdAt");
        }
      }
    });
  }

  return databasePromise;
}

function asNumber(value: number | string | undefined, fallback = Date.now()) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function normalizeImage(image: ImageData | LegacyImage): ImageData | null {
  const legacy = image as LegacyImage;
  if (!image.id || !image.blob) return null;
  return {
    id: image.id,
    itemId: image.itemId || legacy.recordId || "",
    blob: image.blob,
    createdAt: Number(image.createdAt || Date.now())
  };
}

function legacyToItem(record: LegacyRecord): CapsuleItem {
  const now = Date.now();
  return {
    id: String(record.id || createId()),
    seriesId: "",
    name: String(record.title || "無題のカプセルトイ"),
    characterName: "",
    maker: "",
    price: Number(record.cost ?? Number(record.price || 0) * Math.max(1, Number(record.count || 1))),
    obtainedDate: String(record.date || record.playedAt || new Date().toISOString().slice(0, 10)),
    obtainedPlace: String(record.shop || ""),
    memo: String(record.memo || ""),
    favorite: false,
    quantity: Math.max(1, Number(record.count || 1)),
    imageIds: Array.isArray(record.imageIds) ? record.imageIds : [],
    createdAt: asNumber(record.createdAt, now),
    updatedAt: asNumber(record.updatedAt, now)
  };
}

async function migrateLegacyRecords() {
  if (migrationPromise) return migrationPromise;
  migrationPromise = (async () => {
    const db = await getDatabase();
    if (!db.objectStoreNames.contains("records")) return;
    const [items, records] = await Promise.all([db.getAll("items"), db.getAll("records")]);
    if (items.length > 0 || records.length === 0) return;

    const tx = db.transaction(["items", "images"], "readwrite");
    await Promise.all(records.map((record) => tx.objectStore("items").put(legacyToItem(record))));

    const images = await tx.objectStore("images").getAll();
    await Promise.all(
      images.map((image) => {
        const normalized = normalizeImage(image);
        return normalized ? tx.objectStore("images").put(normalized) : Promise.resolve();
      })
    );
    await tx.done;
  })();
  return migrationPromise;
}

export const gachaRepository = {
  async getItems() {
    await migrateLegacyRecords();
    const db = await getDatabase();
    const items = await db.getAll("items");
    return items.sort((a, b) => b.obtainedDate.localeCompare(a.obtainedDate) || b.updatedAt - a.updatedAt);
  },

  async getSeriesList() {
    await migrateLegacyRecords();
    const db = await getDatabase();
    const list = await db.getAll("series");
    return list.sort((a, b) => a.title.localeCompare(b.title, "ja") || b.updatedAt - a.updatedAt);
  },

  async saveItem(item: CapsuleItem, images: ImageData[] = []) {
    const db = await getDatabase();
    const tx = db.transaction(["items", "images"], "readwrite");
    await tx.objectStore("items").put(item);
    await Promise.all(images.map((image) => tx.objectStore("images").put(image)));
    await tx.done;
  },

  async saveSeries(series: CapsuleSeries) {
    const db = await getDatabase();
    await db.put("series", series);
  },

  async deleteItem(id: string) {
    const db = await getDatabase();
    const tx = db.transaction(["items", "images"], "readwrite");
    const images = await tx.objectStore("images").getAll();
    await Promise.all(
      images
        .map(normalizeImage)
        .filter((image): image is ImageData => Boolean(image))
        .filter((image) => image.itemId === id)
        .map((image) => tx.objectStore("images").delete(image.id))
    );
    await tx.objectStore("items").delete(id);
    await tx.done;
  },

  async deleteSeries(id: string) {
    const db = await getDatabase();
    const items = await db.getAllFromIndex("items", "seriesId", id);
    if (items.length > 0) throw new Error("Series has items");
    await db.delete("series", id);
  },

  async getImage(id: string) {
    const db = await getDatabase();
    const image = await db.get("images", id);
    return image ? normalizeImage(image) || undefined : undefined;
  },

  async deleteImage(id: string) {
    const db = await getDatabase();
    await db.delete("images", id);
  },

  async exportBackup(): Promise<CapsuleBackup> {
    await migrateLegacyRecords();
    const db = await getDatabase();
    const [items, series, storedImages] = await Promise.all([db.getAll("items"), db.getAll("series"), db.getAll("images")]);
    const images = await Promise.all(
      storedImages
        .map(normalizeImage)
        .filter((image): image is ImageData => Boolean(image))
        .map(async (image): Promise<BackupImageData> => ({
          id: image.id,
          itemId: image.itemId,
          createdAt: image.createdAt,
          mimeType: image.blob.type || "image/jpeg",
          blobBase64: await blobToBase64(image.blob)
        }))
    );

    return {
      version: 3,
      exportedAt: new Date().toISOString(),
      items,
      series,
      images
    };
  },

  async importBackup(backup: unknown) {
    if (!backup || typeof backup !== "object") throw new Error("Invalid backup");
    const source = backup as Partial<CapsuleBackup> & { records?: LegacyRecord[] };
    const importedItems = Array.isArray(source.items) ? source.items : (source.records || []).map(legacyToItem);
    const importedSeries = Array.isArray(source.series) ? source.series : [];
    const importedImages = await Promise.all(
      (source.images || []).map(async (image) => ({
        id: String(image.id),
        itemId: String(image.itemId || ""),
        createdAt: Number(image.createdAt || Date.now()),
        blob: base64ToBlob(String(image.blobBase64), image.mimeType || "image/jpeg")
      }))
    );

    const db = await getDatabase();
    const tx = db.transaction(["items", "series", "images"], "readwrite");
    await Promise.all(importedSeries.map((series) => tx.objectStore("series").put(series)));
    await Promise.all(importedItems.map((item) => tx.objectStore("items").put(item)));
    await Promise.all(importedImages.map((image) => tx.objectStore("images").put(image)));
    await tx.done;

    return { items: importedItems.length, series: importedSeries.length, images: importedImages.length };
  }
};

async function blobToBase64(blob: Blob) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return dataUrl.split(",")[1] || "";
}

function base64ToBlob(base64: string, mimeType: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}
