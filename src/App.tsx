import { ChangeEvent, FormEvent, TouchEvent, useEffect, useMemo, useRef, useState } from "react";
import { createId, createPendingImages, pendingToStoredImage } from "./imageProcessing";
import { useImageUrl } from "./hooks/useImageUrl";
import { gachaRepository } from "./repositories/gachaRepository";
import type { CapsuleItem, CapsuleItemDraft, CapsuleSeries, CapsuleSeriesDraft, PendingImage } from "./types";

type ViewMode = "home" | "add" | "collection" | "stats" | "settings";
type SortMode = "date-desc" | "price-desc" | "name-asc";

const emptyItemDraft = (): CapsuleItemDraft => ({
  seriesId: "",
  name: "",
  characterName: "",
  maker: "",
  price: 300,
  obtainedDate: new Date().toISOString().slice(0, 10),
  obtainedPlace: "",
  memo: "",
  favorite: false,
  quantity: 1,
  imageIds: []
});

const emptySeriesDraft = (): CapsuleSeriesDraft => ({
  title: "",
  maker: "",
  totalTypes: 0,
  memo: ""
});

function yen(value: number) {
  return new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" }).format(value);
}

function monthLabel(month: string) {
  const [year, value] = month.split("-");
  return `${year}年${Number(value)}月`;
}

export default function App() {
  const [items, setItems] = useState<CapsuleItem[]>([]);
  const [seriesList, setSeriesList] = useState<CapsuleSeries[]>([]);
  const [itemDraft, setItemDraft] = useState<CapsuleItemDraft>(emptyItemDraft);
  const [seriesDraft, setSeriesDraft] = useState<CapsuleSeriesDraft>(emptySeriesDraft);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [removedImageIds, setRemovedImageIds] = useState<string[]>([]);
  const [view, setView] = useState<ViewMode>("home");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingSeriesId, setEditingSeriesId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ imageIds: string[]; index: number } | null>(null);
  const [query, setQuery] = useState("");
  const [seriesQuery, setSeriesQuery] = useState("");
  const [makerQuery, setMakerQuery] = useState("");
  const [placeQuery, setPlaceQuery] = useState("");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("date-desc");
  const [darkMode, setDarkMode] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);

  const selected = items.find((item) => item.id === selectedId) || null;
  const seriesById = useMemo(() => new Map(seriesList.map((series) => [series.id, series])), [seriesList]);
  const totalQuantity = useMemo(() => items.reduce((sum, item) => sum + item.quantity, 0), [items]);
  const totalSpent = useMemo(() => items.reduce((sum, item) => sum + item.price * item.quantity, 0), [items]);
  const duplicateCount = useMemo(() => items.reduce((sum, item) => sum + Math.max(0, item.quantity - 1), 0), [items]);

  const seriesStats = useMemo(() => {
    return seriesList.map((series) => {
      const ownedTypes = new Set(items.filter((item) => item.seriesId === series.id).map((item) => item.characterName || item.name)).size;
      const totalTypes = Math.max(0, series.totalTypes);
      const completion = totalTypes > 0 ? Math.min(100, Math.round((ownedTypes / totalTypes) * 100)) : 0;
      const duplicates = items.filter((item) => item.seriesId === series.id).reduce((sum, item) => sum + Math.max(0, item.quantity - 1), 0);
      const spent = items.filter((item) => item.seriesId === series.id).reduce((sum, item) => sum + item.price * item.quantity, 0);
      return { series, ownedTypes, totalTypes, completion, duplicates, spent, incomplete: totalTypes > 0 && ownedTypes < totalTypes };
    });
  }, [items, seriesList]);

  const filteredItems = useMemo(() => {
    const incompleteSeriesIds = new Set(seriesStats.filter((stat) => stat.incomplete).map((stat) => stat.series.id));
    return items
      .filter((item) => {
        const series = seriesById.get(item.seriesId);
        const productMatch = [item.name, item.characterName].join(" ").toLowerCase().includes(query.toLowerCase());
        const seriesMatch = (series?.title || "").toLowerCase().includes(seriesQuery.toLowerCase());
        const makerMatch = [item.maker, series?.maker || ""].join(" ").toLowerCase().includes(makerQuery.toLowerCase());
        const placeMatch = item.obtainedPlace.toLowerCase().includes(placeQuery.toLowerCase());
        return (
          productMatch &&
          seriesMatch &&
          makerMatch &&
          placeMatch &&
          (!favoriteOnly || item.favorite) &&
          (!duplicatesOnly || item.quantity > 1) &&
          (!incompleteOnly || incompleteSeriesIds.has(item.seriesId))
        );
      })
      .sort((a, b) => {
        if (sortMode === "price-desc") return b.price * b.quantity - a.price * a.quantity;
        if (sortMode === "name-asc") return a.name.localeCompare(b.name, "ja");
        return b.obtainedDate.localeCompare(a.obtainedDate) || b.updatedAt - a.updatedAt;
      });
  }, [duplicatesOnly, favoriteOnly, incompleteOnly, items, makerQuery, placeQuery, query, seriesById, seriesQuery, seriesStats, sortMode]);

  const monthlyTotals = useMemo(() => {
    const totals = items.reduce<Record<string, number>>((acc, item) => {
      const month = item.obtainedDate.slice(0, 7);
      acc[month] = (acc[month] || 0) + item.price * item.quantity;
      return acc;
    }, {});
    return Object.entries(totals).sort(([a], [b]) => b.localeCompare(a));
  }, [items]);

  const makerCounts = useMemo(() => {
    const counts = items.reduce<Record<string, number>>((acc, item) => {
      const maker = item.maker || seriesById.get(item.seriesId)?.maker || "未入力";
      acc[maker] = (acc[maker] || 0) + item.quantity;
      return acc;
    }, {});
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [items, seriesById]);

  async function refresh() {
    try {
      const [nextItems, nextSeries] = await Promise.all([gachaRepository.getItems(), gachaRepository.getSeriesList()]);
      setItems(nextItems);
      setSeriesList(nextSeries);
      setError("");
    } catch {
      setError("IndexedDBからデータを読み込めませんでした。");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? "dark" : "light";
  }, [darkMode]);

  function resetItemForm() {
    pendingImages.forEach((image) => URL.revokeObjectURL(image.previewUrl));
    setItemDraft(emptyItemDraft());
    setPendingImages([]);
    setRemovedImageIds([]);
    setEditingItemId(null);
  }

  function resetSeriesForm() {
    setSeriesDraft(emptySeriesDraft());
    setEditingSeriesId(null);
  }

  async function handleImageInput(event: ChangeEvent<HTMLInputElement>) {
    if (!event.target.files?.length) return;
    setIsBusy(true);
    try {
      const images = await createPendingImages(event.target.files);
      setPendingImages((current) => [...current, ...images]);
      setMessage(`${images.length}枚の画像を圧縮しました。`);
    } catch {
      setError("画像の処理に失敗しました。");
    } finally {
      setIsBusy(false);
      event.target.value = "";
    }
  }

  async function saveItem(event: FormEvent) {
    event.preventDefault();
    setIsBusy(true);
    try {
      const now = Date.now();
      const existing = editingItemId ? items.find((item) => item.id === editingItemId) : null;
      const itemId = existing?.id || createId();
      const storedImages = pendingImages.map((image) => pendingToStoredImage(image, itemId));
      const item: CapsuleItem = {
        ...itemDraft,
        id: itemId,
        name: itemDraft.name.trim(),
        characterName: itemDraft.characterName.trim(),
        maker: itemDraft.maker.trim(),
        obtainedPlace: itemDraft.obtainedPlace.trim(),
        memo: itemDraft.memo.trim(),
        price: Math.max(0, Number(itemDraft.price)),
        quantity: Math.max(1, Number(itemDraft.quantity)),
        imageIds: [...itemDraft.imageIds, ...storedImages.map((image) => image.id)],
        createdAt: existing?.createdAt || now,
        updatedAt: now
      };
      await gachaRepository.saveItem(item, storedImages);
      await Promise.all(removedImageIds.map((id) => gachaRepository.deleteImage(id)));
      await refresh();
      resetItemForm();
      setSelectedId(item.id);
      setView("home");
      setMessage(existing ? "アイテムを更新しました。" : "アイテムを登録しました。");
    } catch {
      setError("アイテムを保存できませんでした。");
    } finally {
      setIsBusy(false);
    }
  }

  async function saveSeries(event: FormEvent) {
    event.preventDefault();
    setIsBusy(true);
    try {
      const now = Date.now();
      const existing = editingSeriesId ? seriesList.find((series) => series.id === editingSeriesId) : null;
      const series: CapsuleSeries = {
        id: existing?.id || createId(),
        title: seriesDraft.title.trim(),
        maker: seriesDraft.maker.trim(),
        totalTypes: Math.max(0, Number(seriesDraft.totalTypes)),
        memo: seriesDraft.memo.trim(),
        createdAt: existing?.createdAt || now,
        updatedAt: now
      };
      await gachaRepository.saveSeries(series);
      await refresh();
      resetSeriesForm();
      setMessage(existing ? "シリーズを更新しました。" : "シリーズを登録しました。");
    } catch {
      setError("シリーズを保存できませんでした。");
    } finally {
      setIsBusy(false);
    }
  }

  function editItem(item: CapsuleItem) {
    resetItemForm();
    setItemDraft({
      seriesId: item.seriesId,
      name: item.name,
      characterName: item.characterName,
      maker: item.maker,
      price: item.price,
      obtainedDate: item.obtainedDate,
      obtainedPlace: item.obtainedPlace,
      memo: item.memo,
      favorite: item.favorite,
      quantity: item.quantity,
      imageIds: item.imageIds
    });
    setEditingItemId(item.id);
    setSelectedId(null);
    setView("add");
  }

  function editSeries(series: CapsuleSeries) {
    setSeriesDraft({
      title: series.title,
      maker: series.maker,
      totalTypes: series.totalTypes,
      memo: series.memo
    });
    setEditingSeriesId(series.id);
  }

  async function deleteItem(item: CapsuleItem) {
    if (!confirm(`「${item.name}」を削除しますか？画像も削除されます。`)) return;
    await gachaRepository.deleteItem(item.id);
    await refresh();
    setSelectedId(null);
    setMessage("アイテムを削除しました。");
  }

  async function changeQuantity(item: CapsuleItem, delta: number) {
    const next = { ...item, quantity: Math.max(1, item.quantity + delta), updatedAt: Date.now() };
    await gachaRepository.saveItem(next);
    await refresh();
  }

  async function toggleFavorite(item: CapsuleItem) {
    await gachaRepository.saveItem({ ...item, favorite: !item.favorite, updatedAt: Date.now() });
    await refresh();
  }

  async function exportJson() {
    setIsBusy(true);
    try {
      const backup = await gachaRepository.exportBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `capsule-collection-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage(`バックアップを作成しました。アイテム${backup.items.length}件、画像${backup.images.length}枚。`);
    } catch {
      setError("バックアップを作成できませんでした。");
    } finally {
      setIsBusy(false);
    }
  }

  async function importJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!confirm("同じIDのデータは上書きされます。インポートしますか？")) {
      event.target.value = "";
      return;
    }
    setIsBusy(true);
    try {
      const result = await gachaRepository.importBackup(JSON.parse(await file.text()));
      await refresh();
      setMessage(`インポートしました。アイテム${result.items}件、シリーズ${result.series}件、画像${result.images}枚。`);
    } catch {
      setError("JSONを読み込めませんでした。");
    } finally {
      setIsBusy(false);
      event.target.value = "";
    }
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <p className="eyebrow">Capsule Toy Collection</p>
        <h1>カプセルトイ管理</h1>
        <p className="lead">実物のガチャガチャを写真つきで管理。オフラインでも使えます。</p>
      </header>

      {message && <p className="toast">{message}</p>}
      {error && <p className="error-box">{error}</p>}
      {isBusy && <p className="busy-box">処理中です...</p>}

      {view === "home" && (
        <section className="view-stack">
          <SummaryBar totalQuantity={totalQuantity} totalSpent={totalSpent} duplicates={duplicateCount} />
          <Filters
            duplicatesOnly={duplicatesOnly}
            favoriteOnly={favoriteOnly}
            incompleteOnly={incompleteOnly}
            makerQuery={makerQuery}
            placeQuery={placeQuery}
            query={query}
            seriesQuery={seriesQuery}
            sortMode={sortMode}
            onDuplicatesOnly={setDuplicatesOnly}
            onFavoriteOnly={setFavoriteOnly}
            onIncompleteOnly={setIncompleteOnly}
            onMakerQuery={setMakerQuery}
            onPlaceQuery={setPlaceQuery}
            onQuery={setQuery}
            onSeriesQuery={setSeriesQuery}
            onSortMode={setSortMode}
          />
          <div className="item-list">
            {filteredItems.map((item) => (
              <ItemCard key={item.id} item={item} series={seriesById.get(item.seriesId)} onOpen={() => setSelectedId(item.id)} onFavorite={() => toggleFavorite(item)} onQuantity={changeQuantity} />
            ))}
          </div>
          {filteredItems.length === 0 && <EmptyState title="アイテムがありません" subtitle="登録タブから最初のカプセルトイを追加しましょう。" />}
        </section>
      )}

      {view === "add" && (
        <section className="view-stack">
          <ItemForm
            draft={itemDraft}
            editing={Boolean(editingItemId)}
            isBusy={isBusy}
            pendingImages={pendingImages}
            seriesList={seriesList}
            onChange={(field, value) => setItemDraft((current) => ({ ...current, [field]: value }))}
            onImageInput={handleImageInput}
            onRemovePending={(id) => setPendingImages((current) => current.filter((image) => image.id !== id))}
            onRemoveStored={(id) => {
              setItemDraft((current) => ({ ...current, imageIds: current.imageIds.filter((imageId) => imageId !== id) }));
              setRemovedImageIds((current) => [...current, id]);
            }}
            onReset={resetItemForm}
            onSubmit={saveItem}
          />
          <SeriesForm draft={seriesDraft} editing={Boolean(editingSeriesId)} isBusy={isBusy} onChange={(field, value) => setSeriesDraft((current) => ({ ...current, [field]: value }))} onReset={resetSeriesForm} onSubmit={saveSeries} />
        </section>
      )}

      {view === "collection" && (
        <section className="view-stack">
          {seriesStats.map((stat) => (
            <SeriesCard key={stat.series.id} stat={stat} onEdit={() => editSeries(stat.series)} onOpenEdit={() => setView("add")} />
          ))}
          {seriesStats.length === 0 && <EmptyState title="シリーズがありません" subtitle="登録タブでシリーズを作るとコンプ率を管理できます。" />}
          {items.filter((item) => item.quantity > 1).length > 0 && (
            <section className="panel">
              <h2>交換用リスト</h2>
              <div className="trade-list">
                {items.filter((item) => item.quantity > 1).map((item) => (
                  <button key={item.id} type="button" onClick={() => setSelectedId(item.id)}>
                    {item.characterName || item.name} <strong>+{item.quantity - 1}</strong>
                  </button>
                ))}
              </div>
            </section>
          )}
        </section>
      )}

      {view === "stats" && (
        <StatsView duplicateCount={duplicateCount} items={items} makerCounts={makerCounts} monthlyTotals={monthlyTotals} seriesStats={seriesStats} totalQuantity={totalQuantity} totalSpent={totalSpent} />
      )}

      {view === "settings" && (
        <section className="view-stack">
          <section className="panel">
            <h2>設定</h2>
            <label className="check-row">
              <input type="checkbox" checked={darkMode} onChange={(event) => setDarkMode(event.target.checked)} />
              ダークモード
            </label>
          </section>
          <section className="backup-card">
            <h2>バックアップ</h2>
            <p>画像はBase64としてJSONに含まれます。画像が多いほどファイルサイズは大きくなります。</p>
            <div className="backup-actions">
              <button type="button" onClick={exportJson} disabled={items.length === 0 || isBusy}>
                JSONエクスポート
              </button>
              <button type="button" onClick={() => importInput.current?.click()} disabled={isBusy}>
                JSONインポート
              </button>
              <input ref={importInput} hidden type="file" accept="application/json,.json" onChange={importJson} />
            </div>
          </section>
        </section>
      )}

      {selected && <ItemDetail item={selected} series={seriesById.get(selected.seriesId)} onClose={() => setSelectedId(null)} onDelete={() => deleteItem(selected)} onEdit={() => editItem(selected)} onOpenImage={(index) => setViewer({ imageIds: selected.imageIds, index })} />}
      {viewer && <ImageViewer imageIds={viewer.imageIds} initialIndex={viewer.index} onClose={() => setViewer(null)} />}

      <nav className="bottom-nav" aria-label="メインナビゲーション">
        {[
          ["home", "ホーム"],
          ["add", "登録"],
          ["collection", "コレクション"],
          ["stats", "統計"],
          ["settings", "設定"]
        ].map(([key, label]) => (
          <button key={key} className={view === key ? "active" : ""} type="button" onClick={() => setView(key as ViewMode)}>
            {label}
          </button>
        ))}
      </nav>
    </main>
  );
}

function SummaryBar({ totalQuantity, totalSpent, duplicates }: { totalQuantity: number; totalSpent: number; duplicates: number }) {
  return (
    <div className="summary-grid">
      <StatCard label="総所持数" value={`${totalQuantity}個`} />
      <StatCard label="総支出額" value={yen(totalSpent)} />
      <StatCard label="ダブり" value={`${duplicates}個`} />
    </div>
  );
}

function Filters(props: {
  duplicatesOnly: boolean;
  favoriteOnly: boolean;
  incompleteOnly: boolean;
  makerQuery: string;
  placeQuery: string;
  query: string;
  seriesQuery: string;
  sortMode: SortMode;
  onDuplicatesOnly: (value: boolean) => void;
  onFavoriteOnly: (value: boolean) => void;
  onIncompleteOnly: (value: boolean) => void;
  onMakerQuery: (value: string) => void;
  onPlaceQuery: (value: string) => void;
  onQuery: (value: string) => void;
  onSeriesQuery: (value: string) => void;
  onSortMode: (value: SortMode) => void;
}) {
  return (
    <section className="panel filter-panel">
      <input value={props.query} onChange={(event) => props.onQuery(event.target.value)} placeholder="商品名・種類名で検索" />
      <div className="form-grid">
        <input value={props.seriesQuery} onChange={(event) => props.onSeriesQuery(event.target.value)} placeholder="シリーズ名" />
        <input value={props.makerQuery} onChange={(event) => props.onMakerQuery(event.target.value)} placeholder="メーカー" />
      </div>
      <input value={props.placeQuery} onChange={(event) => props.onPlaceQuery(event.target.value)} placeholder="入手場所" />
      <select value={props.sortMode} onChange={(event) => props.onSortMode(event.target.value as SortMode)}>
        <option value="date-desc">日付順</option>
        <option value="price-desc">金額順</option>
        <option value="name-asc">名前順</option>
      </select>
      <div className="toggle-row">
        <label><input type="checkbox" checked={props.favoriteOnly} onChange={(event) => props.onFavoriteOnly(event.target.checked)} /> お気に入り</label>
        <label><input type="checkbox" checked={props.duplicatesOnly} onChange={(event) => props.onDuplicatesOnly(event.target.checked)} /> ダブり</label>
        <label><input type="checkbox" checked={props.incompleteOnly} onChange={(event) => props.onIncompleteOnly(event.target.checked)} /> 未コンプ</label>
      </div>
    </section>
  );
}

function ItemForm(props: {
  draft: CapsuleItemDraft;
  editing: boolean;
  isBusy: boolean;
  pendingImages: PendingImage[];
  seriesList: CapsuleSeries[];
  onChange: (field: keyof CapsuleItemDraft, value: string | number | boolean) => void;
  onImageInput: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemovePending: (id: string) => void;
  onRemoveStored: (id: string) => void;
  onReset: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);
  return (
    <section className="panel">
      <div className="section-title">
        <h2>{props.editing ? "アイテム編集" : "アイテム登録"}</h2>
        {props.editing && <button type="button" className="ghost-button" onClick={props.onReset}>取消</button>}
      </div>
      <form className="record-form" onSubmit={props.onSubmit}>
        <label>商品名<input required value={props.draft.name} onChange={(event) => props.onChange("name", event.target.value)} placeholder="例: 眠る猫フィギュア" /></label>
        <div className="form-grid">
          <label>シリーズ<select value={props.draft.seriesId} onChange={(event) => props.onChange("seriesId", event.target.value)}><option value="">未設定</option>{props.seriesList.map((series) => <option key={series.id} value={series.id}>{series.title}</option>)}</select></label>
          <label>種類名<input value={props.draft.characterName} onChange={(event) => props.onChange("characterName", event.target.value)} placeholder="例: 三毛猫" /></label>
        </div>
        <div className="form-grid">
          <label>メーカー<input value={props.draft.maker} onChange={(event) => props.onChange("maker", event.target.value)} /></label>
          <label>金額<input type="number" min="0" step="100" value={props.draft.price} onChange={(event) => props.onChange("price", Number(event.target.value))} /></label>
        </div>
        <div className="form-grid">
          <label>入手日<input type="date" value={props.draft.obtainedDate} onChange={(event) => props.onChange("obtainedDate", event.target.value)} /></label>
          <label>所持数<input type="number" min="1" value={props.draft.quantity} onChange={(event) => props.onChange("quantity", Number(event.target.value))} /></label>
        </div>
        <label>入手場所<input value={props.draft.obtainedPlace} onChange={(event) => props.onChange("obtainedPlace", event.target.value)} placeholder="駅前 / 店名" /></label>
        <label>メモ<textarea value={props.draft.memo} onChange={(event) => props.onChange("memo", event.target.value)} /></label>
        <label className="check-row"><input type="checkbox" checked={props.draft.favorite} onChange={(event) => props.onChange("favorite", event.target.checked)} /> お気に入り</label>
        <div className="image-actions">
          <button type="button" onClick={() => cameraInput.current?.click()} disabled={props.isBusy}>カメラ撮影</button>
          <button type="button" onClick={() => libraryInput.current?.click()} disabled={props.isBusy}>写真を選択</button>
          <input ref={cameraInput} hidden type="file" accept="image/*" capture="environment" onChange={props.onImageInput} />
          <input ref={libraryInput} hidden type="file" accept="image/*" multiple onChange={props.onImageInput} />
        </div>
        {(props.draft.imageIds.length > 0 || props.pendingImages.length > 0) && <div className="edit-image-grid">{props.draft.imageIds.map((id) => <EditableStoredImage key={id} imageId={id} onRemove={() => props.onRemoveStored(id)} />)}{props.pendingImages.map((image) => <div className="editable-image" key={image.id}><img src={image.previewUrl} alt="" loading="lazy" /><button type="button" onClick={() => props.onRemovePending(image.id)}>削除</button></div>)}</div>}
        <button className="primary-button" type="submit" disabled={props.isBusy}>{props.editing ? "更新する" : "登録する"}</button>
      </form>
    </section>
  );
}

function SeriesForm(props: { draft: CapsuleSeriesDraft; editing: boolean; isBusy: boolean; onChange: (field: keyof CapsuleSeriesDraft, value: string | number) => void; onReset: () => void; onSubmit: (event: FormEvent) => void }) {
  return (
    <section className="panel">
      <div className="section-title">
        <h2>{props.editing ? "シリーズ編集" : "シリーズ登録"}</h2>
        {props.editing && <button type="button" className="ghost-button" onClick={props.onReset}>取消</button>}
      </div>
      <form className="record-form" onSubmit={props.onSubmit}>
        <label>シリーズ名<input required value={props.draft.title} onChange={(event) => props.onChange("title", event.target.value)} /></label>
        <div className="form-grid">
          <label>メーカー<input value={props.draft.maker} onChange={(event) => props.onChange("maker", event.target.value)} /></label>
          <label>全何種類<input type="number" min="0" value={props.draft.totalTypes} onChange={(event) => props.onChange("totalTypes", Number(event.target.value))} /></label>
        </div>
        <label>メモ<textarea value={props.draft.memo} onChange={(event) => props.onChange("memo", event.target.value)} /></label>
        <button className="primary-button" type="submit" disabled={props.isBusy}>{props.editing ? "更新する" : "シリーズ登録"}</button>
      </form>
    </section>
  );
}

function ItemCard({ item, series, onOpen, onFavorite, onQuantity }: { item: CapsuleItem; series?: CapsuleSeries; onOpen: () => void; onFavorite: () => void; onQuantity: (item: CapsuleItem, delta: number) => void }) {
  return (
    <article className="item-card">
      <button type="button" className="item-main" onClick={onOpen}>
        <ImageThumb imageId={item.imageIds[0]} />
        <span><strong>{item.name}</strong><small>{item.characterName || "種類名未入力"} / {series?.title || "シリーズ未設定"}</small><small>{yen(item.price)} x {item.quantity} / {item.obtainedPlace || "場所未入力"}</small></span>
      </button>
      <div className="item-actions">
        <button type="button" onClick={onFavorite}>{item.favorite ? "★" : "☆"}</button>
        <button type="button" onClick={() => onQuantity(item, -1)}>-</button>
        <b>{item.quantity}</b>
        <button type="button" onClick={() => onQuantity(item, 1)}>+</button>
      </div>
    </article>
  );
}

function SeriesCard({ stat, onEdit, onOpenEdit }: { stat: { series: CapsuleSeries; ownedTypes: number; totalTypes: number; completion: number; duplicates: number; spent: number }; onEdit: () => void; onOpenEdit: () => void }) {
  return (
    <section className="series-card">
      <div className="section-title"><h2>{stat.series.title}</h2><button type="button" onClick={() => { onEdit(); onOpenEdit(); }}>編集</button></div>
      <p>{stat.series.maker || "メーカー未入力"}</p>
      <div className="progress"><span style={{ width: `${stat.completion}%` }} /></div>
      <div className="series-meta"><strong>{stat.ownedTypes}/{stat.totalTypes || "-"}種類</strong><span>コンプ率 {stat.completion}%</span><span>ダブり {stat.duplicates}個</span><span>{yen(stat.spent)}</span></div>
    </section>
  );
}

function StatsView({ duplicateCount, items, makerCounts, monthlyTotals, seriesStats, totalQuantity, totalSpent }: { duplicateCount: number; items: CapsuleItem[]; makerCounts: [string, number][]; monthlyTotals: [string, number][]; seriesStats: { series: CapsuleSeries; completion: number; spent: number }[]; totalQuantity: number; totalSpent: number }) {
  const avgCompletion = seriesStats.length ? Math.round(seriesStats.reduce((sum, stat) => sum + stat.completion, 0) / seriesStats.length) : 0;
  return (
    <section className="view-stack">
      <div className="summary-grid"><StatCard label="総所持数" value={`${totalQuantity}個`} /><StatCard label="総支出額" value={yen(totalSpent)} /><StatCard label="アイテム数" value={`${items.length}件`} /><StatCard label="平均コンプ率" value={`${avgCompletion}%`} /><StatCard label="ダブり合計" value={`${duplicateCount}個`} /></div>
      <ChartPanel title="月別支出額" rows={monthlyTotals.map(([label, value]) => [monthLabel(label), yen(value)])} />
      <ChartPanel title="シリーズ別支出額" rows={seriesStats.map((stat) => [stat.series.title, yen(stat.spent)])} />
      <ChartPanel title="メーカー別所持数" rows={makerCounts.map(([label, value]) => [label, `${value}個`])} />
    </section>
  );
}

function ChartPanel({ title, rows }: { title: string; rows: [string, string][] }) {
  return <section className="panel"><h2>{title}</h2><div className="simple-list">{rows.length ? rows.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>) : <p className="empty">まだデータがありません。</p>}</div></section>;
}

function ItemDetail({ item, series, onClose, onDelete, onEdit, onOpenImage }: { item: CapsuleItem; series?: CapsuleSeries; onClose: () => void; onDelete: () => void; onEdit: () => void; onOpenImage: (index: number) => void }) {
  return (
    <section className="detail-sheet" aria-label="詳細">
      <div className="detail-card">
        <button className="close-button" type="button" onClick={onClose}>閉じる</button>
        <ImageGallery imageIds={item.imageIds} onOpen={onOpenImage} />
        <h2>{item.name}</h2>
        <dl><div><dt>シリーズ</dt><dd>{series?.title || "未設定"}</dd></div><div><dt>種類名</dt><dd>{item.characterName || "未入力"}</dd></div><div><dt>メーカー</dt><dd>{item.maker || series?.maker || "未入力"}</dd></div><div><dt>金額</dt><dd>{yen(item.price)} x {item.quantity} = {yen(item.price * item.quantity)}</dd></div><div><dt>入手日 / 場所</dt><dd>{item.obtainedDate} / {item.obtainedPlace || "未入力"}</dd></div><div><dt>メモ</dt><dd>{item.memo || "メモはありません。"}</dd></div></dl>
        <div className="detail-actions"><button type="button" onClick={onEdit}>編集</button><button type="button" onClick={onDelete}>削除</button></div>
      </div>
    </section>
  );
}

function ImageThumb({ imageId, size = "normal" }: { imageId?: string; size?: "normal" | "large" }) {
  const { url } = useImageUrl(imageId);
  if (!url) return <span className={`thumb thumb-${size} thumb-empty`}>G</span>;
  return <img className={`thumb thumb-${size}`} src={url} alt="" loading="lazy" decoding="async" />;
}

function EditableStoredImage({ imageId, onRemove }: { imageId: string; onRemove: () => void }) {
  const { url } = useImageUrl(imageId);
  return <div className="editable-image">{url ? <img src={url} alt="" loading="lazy" /> : <span className="thumb thumb-normal thumb-empty">G</span>}<button type="button" onClick={onRemove}>削除</button></div>;
}

function ImageGallery({ imageIds, onOpen }: { imageIds: string[]; onOpen: (index: number) => void }) {
  if (imageIds.length === 0) return <span className="thumb thumb-hero thumb-empty">G</span>;
  return <div className="detail-gallery">{imageIds.map((imageId, index) => <button key={imageId} type="button" onClick={() => onOpen(index)}><ImageThumb imageId={imageId} size="large" /></button>)}</div>;
}

function ImageViewer({ imageIds, initialIndex, onClose }: { imageIds: string[]; initialIndex: number; onClose: () => void }) {
  const [index, setIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [pinchStart, setPinchStart] = useState<{ distance: number; zoom: number } | null>(null);
  const { url } = useImageUrl(imageIds[index]);
  function move(delta: number) { setIndex((current) => Math.min(imageIds.length - 1, Math.max(0, current + delta))); setZoom(1); }
  function distance(event: TouchEvent) { const [a, b] = Array.from(event.touches); return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); }
  function handleTouchStart(event: TouchEvent) { if (event.touches.length === 2) setPinchStart({ distance: distance(event), zoom }); else setTouchStartX(event.touches[0]?.clientX ?? null); }
  function handleTouchMove(event: TouchEvent) { if (event.touches.length === 2 && pinchStart) { event.preventDefault(); setZoom(Math.min(4, Math.max(1, pinchStart.zoom * (distance(event) / pinchStart.distance)))); } }
  function handleTouchEnd(event: TouchEvent) { if (pinchStart) { setPinchStart(null); return; } if (touchStartX !== null && event.changedTouches[0]) { const delta = event.changedTouches[0].clientX - touchStartX; if (Math.abs(delta) > 50 && zoom === 1) move(delta > 0 ? -1 : 1); } setTouchStartX(null); }
  return <section className="viewer" onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}><button className="viewer-close" type="button" onClick={onClose}>閉じる</button><button className="viewer-nav viewer-prev" type="button" onClick={() => move(-1)} disabled={index === 0}>前</button>{url && <img src={url} alt="" style={{ transform: `scale(${zoom})` }} />}<button className="viewer-nav viewer-next" type="button" onClick={() => move(1)} disabled={index === imageIds.length - 1}>次</button><p>{index + 1} / {imageIds.length}</p></section>;
}

function StatCard({ label, value }: { label: string; value: string }) {
  return <div className="stat-card"><strong>{value}</strong><span>{label}</span></div>;
}

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return <section className="empty-state"><div className="empty-mark">G</div><h2>{title}</h2><p>{subtitle}</p></section>;
}
