"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";

type Location = { id: string; code: string; name: string; is_default: boolean; is_active: boolean };
type Center = { id: string; code: string; name: string; allow_multiple_locations: boolean; locations: Location[] };
type Supplier = { id: string; name: string; phone: string | null };
type Quality = { id: string; name: string; default_price: number | string; is_active: boolean; is_base: boolean };
type Product = { id: string; code: string; name: string; category: string | null; unit_of_measure: string; product_qualities: Quality[] };
type Line = { key: string; product_id: string; quality_id: string; location_id: string; quantity: number; sack_count: number; actual_price: number };
type LaborSession = { id: string; center_id: string; title: string; operation: string; session_date: string };

const money = (n: number) => new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR", maximumFractionDigits: 2 }).format(n);

export function DetailedPurchaseEntry({
  center, suppliers, supplierId, onSupplierChange, onAddSupplier, products, visibleLines, total,
  laborSessions, laborSessionId, laborLoadCount, onLaborSessionChange, onLaborLoadCountChange, canManageLabor,
  onSelectProduct, onAddWeightRow, onUpdateLine, onRemoveLine, onOpenPayment, onSetError,
}: {
  center?: Center;
  suppliers: Supplier[];
  supplierId: string;
  onSupplierChange: (id: string) => void;
  onAddSupplier: () => void;
  products: Product[];
  visibleLines: Line[];
  total: number;
  totalSacks: number;
  laborSessions: LaborSession[];
  laborSessionId: string;
  laborLoadCount: string;
  onLaborSessionChange: (id: string) => void;
  onLaborLoadCountChange: (loads: string) => void;
  canManageLabor: boolean;
  onSelectProduct: (product: Product) => void;
  onAddWeightRow: (line: Line) => string;
  onUpdateLine: (key: string, change: Partial<Line>) => void;
  onRemoveLine: (key: string) => void;
  onOpenPayment: () => void;
  onSetError: (message: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [showProductPicker, setShowProductPicker] = useState(visibleLines.length === 0);
  useEffect(() => {
    if (visibleLines.length === 0) setShowProductPicker(true);
    else setShowProductPicker(false);
  }, [visibleLines.length]);
  const categories = useMemo(() => [...new Set(products.map(p => p.category).filter(Boolean))] as string[], [products]);
  const filtered = products.filter(p => p.product_qualities.some(q => q.is_active) && (category === "all" || p.category === category) && `${p.code} ${p.name}`.toLowerCase().includes(search.toLowerCase().trim()));
  const groups = useMemo(() => {
    const map = new Map<string, { product: Product; quality: Quality; lines: Line[] }>();
    for (const line of visibleLines) {
      const product = products.find(p => p.id === line.product_id);
      const quality = product?.product_qualities.find(q => q.id === line.quality_id);
      if (!product || !quality) continue;
      const key = `${line.product_id}:${line.quality_id}`;
      const group = map.get(key) ?? { product, quality, lines: [] };
      group.lines.push(line);
      map.set(key, group);
    }
    return [...map.values()];
  }, [visibleLines, products]);
  const availableSessions = laborSessions.filter(session => session.center_id === center?.id);
  const farmerName = supplierId === "__cash_farmer__" || !supplierId
    ? "Cash Farmer"
    : suppliers.find(supplier => supplier.id === supplierId)?.name ?? "Select farmer";
  function addRowAndFocus(line: Line) {
    const newKey = onAddWeightRow(line);
    requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>(`[data-entry-line="${newKey}"][data-entry-field="weight"]`)?.focus();
    });
  }

  function handleEnter(event: React.KeyboardEvent<HTMLInputElement>, line: Line, field: "weight" | "sacks") {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (field === "weight") {
      document.querySelector<HTMLInputElement>(`[data-entry-line="${line.key}"][data-entry-field="sacks"]`)?.focus();
      return;
    }
    addRowAndFocus(line);
  }

  return (
    <main className="detail-purchase-scroll">
      <div className="detail-purchase-content">
        {showProductPicker ? <>
          <header className="detail-purchase-heading">
            <div><span className="eyebrow dark">PURCHASE ORDER</span><h1>{visibleLines.length ? "Add product" : "Choose a product"}</h1><p>Choose the farmer and product before entering weights.</p></div>
            {visibleLines.length > 0 && <button type="button" className="ghost detail-back-to-entry" onClick={() => setShowProductPicker(false)}>Back to weighing</button>}
          </header>

          <section className="detail-party-section">
            <label>Farmer / supplier
              <select value={supplierId || "__cash_farmer__"} onChange={e => onSupplierChange(e.target.value === "__cash_farmer__" ? "__cash_farmer__" : e.target.value)}>
                <option value="__cash_farmer__">Cash Farmer (default)</option>
                {suppliers.filter(s => s.name.trim().toLowerCase() !== "cash farmer").map(s => <option key={s.id} value={s.id}>{s.name}{s.phone ? ` · ${s.phone}` : ""}</option>)}
                {suppliers.filter(s => s.name.trim().toLowerCase() === "cash farmer").map(s => <option key={s.id} value={s.id}>{s.name}{s.phone ? ` · ${s.phone}` : ""}</option>)}
              </select>
            </label>
            <button className="ghost detail-add-farmer" type="button" onClick={onAddSupplier}><Plus size={16}/> Add farmer</button>
          </section>

          {center?.allow_multiple_locations && <p className="detail-location-hint">Choose a stock location for every product.</p>}

          <section className="detail-product-picker">
            <h2>Products</h2>
            <label className="detail-product-search"><Search size={17}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search product name or code"/><span className="sr-only">Search products</span></label>
            <div className="detail-categories"><button type="button" className={category === "all" ? "selected" : ""} onClick={() => setCategory("all")}>All</button>{categories.map(c => <button type="button" key={c} className={category === c ? "selected" : ""} onClick={() => setCategory(c)}>{c}</button>)}</div>
            <div className="detail-product-list">
              {filtered.map(product => {
                const qualities = product.product_qualities.filter(q => q.is_active);
                const quality = qualities.length === 1 ? qualities[0] : null;
                return <button key={product.id} type="button" className="detail-product-choice" onClick={() => onSelectProduct(product)}>
                  <span><strong>{product.name}</strong><small>{product.code} · {product.category || "Uncategorized"} · {product.unit_of_measure}</small></span>
                  <b>{quality ? "＋ Select" : `${qualities.length} qualities`}</b>
                </button>;
              })}
              {!filtered.length && <p className="detail-empty-products">No active products match this search.</p>}
            </div>
          </section>
        </> : <>
          <div className="detail-farmer-context"><small>Farmer</small><strong>{farmerName}</strong></div>
          <header className="detail-purchase-heading detail-entry-heading">
            <div><span className="eyebrow dark">PURCHASE ORDER</span><h1>Enter weights</h1></div>
            <button type="button" className="ghost detail-back-to-entry" onClick={() => setShowProductPicker(true)}><Plus size={16}/> Add product</button>
          </header>
        </>}

        {!showProductPicker && <section className="detail-weight-sections" aria-label="Selected products and weight entries">
          {groups.map(({ product, quality, lines }) => {
            const price = lines[0]?.actual_price ?? 0;
            const productWeight = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
            const productSacks = lines.reduce((sum, line) => sum + (Number(line.sack_count) || 0), 0);
            const productTotal = lines.reduce((sum, line) => sum + ((Number(line.quantity) || 0) * (Number(line.actual_price) || 0)), 0);
            return <article className="detail-product-group" key={`${product.id}:${quality.id}`}>
              <header><div><strong>{product.name}</strong><small>{quality.is_base ? "No quality" : quality.name} · {product.unit_of_measure}</small></div><button type="button" className="detail-add-row" onClick={() => addRowAndFocus(lines[0])}><Plus size={15}/> Add weighing</button></header>
              <div className="detail-product-summary" aria-live="polite">
                <div><small>Total weight</small><strong>{productWeight.toLocaleString("en-LK", { maximumFractionDigits: 3 })} {product.unit_of_measure}</strong></div>
                <div><small>Total sacks</small><strong>{productSacks.toLocaleString("en-LK")}</strong></div>
                <div><small>Product total</small><strong>{money(productTotal)}</strong></div>
              </div>
              <label className="detail-price-field">Purchase price per kg (LKR)<input type="number" min="0" step="0.01" value={price} onChange={e => lines.forEach(line => onUpdateLine(line.key, { actual_price: Number(e.target.value) }))}/></label>
              {center?.allow_multiple_locations && <label className="detail-location-field">Stock location<select value={lines[0]?.location_id ?? ""} onChange={e => lines.forEach(line => onUpdateLine(line.key, { location_id: e.target.value }))}><option value="">Select location</option>{center.locations.filter(l => l.is_active).map(location => <option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}</select></label>}
              <div className="detail-weight-rows">
                {lines.map((line, index) => <div className="detail-weight-row" key={line.key}>
                  <span className="detail-row-number">{index + 1}</span>
                  <label>Weight (kg)<input data-entry-line={line.key} data-entry-field="weight" type="number" inputMode="decimal" min="0" step="0.01" value={line.quantity || ""} placeholder="0" onKeyDown={e => handleEnter(e, line, "weight")} onChange={e => onUpdateLine(line.key, { quantity: Number(e.target.value) })}/></label>
                  <label>Sacks<input data-entry-line={line.key} data-entry-field="sacks" type="number" inputMode="numeric" min="0" step="1" value={line.sack_count || ""} placeholder="0" onKeyDown={e => handleEnter(e, line, "sacks")} onChange={e => onUpdateLine(line.key, { sack_count: Number(e.target.value) })}/></label>
                  <button type="button" aria-label={`Remove weighing ${index + 1}`} onClick={() => onRemoveLine(line.key)}><Trash2 size={17}/></button>
                </div>)}
              </div>
            </article>;
          })}
          {!groups.length && <div className="detail-empty-weight">Select a product above to start entering weights.</div>}
        </section>}

        {!showProductPicker && <section className="detail-labor-section" aria-label="Purchase labor session">
          <div className="detail-labor-heading"><strong>Labor session</strong><small>Optional · track loads against this purchase</small></div>
          <div className="detail-labor-fields">
            <label>Session
              <select value={availableSessions.some(s => s.id === laborSessionId) ? laborSessionId : ""} onChange={e => onLaborSessionChange(e.target.value)}>
                <option value="">No labor session</option>
                {availableSessions.map(session => <option key={session.id} value={session.id}>{session.title} · {session.session_date}</option>)}
              </select>
            </label>
            <label>Loads
              <input type="number" min="0" step="1" inputMode="numeric" value={laborLoadCount} disabled={!laborSessionId} onChange={e => onLaborLoadCountChange(e.target.value)} />
            </label>
          </div>
          {availableSessions.length === 0 && <p className="detail-labor-hint">No open purchase labor sessions for this center. {canManageLabor && <a href="/dashboard/labor/sessions" target="_blank" rel="noopener noreferrer">Open Labor Sessions</a>}</p>}
        </section>}

        {!showProductPicker && <footer className="detail-purchase-footer">
          <div><small>Purchase total</small><strong>{money(total)}</strong></div>
          <button type="button" className="primary" disabled={!visibleLines.length} onClick={() => { onSetError(""); onOpenPayment(); }}>Continue to payment</button>
        </footer>}
      </div>
    </main>
  );
}
