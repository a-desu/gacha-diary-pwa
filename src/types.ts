export type CapsuleItem = {
  id: string;
  seriesId: string;
  name: string;
  characterName: string;
  maker: string;
  price: number;
  obtainedDate: string;
  obtainedPlace: string;
  memo: string;
  favorite: boolean;
  quantity: number;
  imageIds: string[];
  createdAt: number;
  updatedAt: number;
};

export type CapsuleSeries = {
  id: string;
  title: string;
  maker: string;
  totalTypes: number;
  memo: string;
  createdAt: number;
  updatedAt: number;
};

export type ImageData = {
  id: string;
  itemId: string;
  blob: Blob;
  createdAt: number;
};

export type CapsuleItemDraft = Pick<
  CapsuleItem,
  "seriesId" | "name" | "characterName" | "maker" | "price" | "obtainedDate" | "obtainedPlace" | "memo" | "favorite" | "quantity" | "imageIds"
>;

export type CapsuleSeriesDraft = Pick<CapsuleSeries, "title" | "maker" | "totalTypes" | "memo">;

export type PendingImage = {
  id: string;
  blob: Blob;
  previewUrl: string;
  createdAt: number;
};

export type BackupImageData = Omit<ImageData, "blob"> & {
  blobBase64: string;
  mimeType: string;
};

export type CapsuleBackup = {
  version: 3;
  exportedAt: string;
  items: CapsuleItem[];
  series: CapsuleSeries[];
  images: BackupImageData[];
};
