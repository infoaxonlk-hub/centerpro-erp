"use client";

import {useMemo, useState} from "react";
import {Plus, Search, Trash2, UserPlus} from "lucide-react";
import type {Center, Customer, Line, Product} from "./types";
import {cents, money} from "./types";

type Choice = {product: Product; quality: Product["product_qualities"][number]};
type Props = {
  center?: Center;
  customers: Customer[];
  customerId: string;
  onCustomerChange: (id: string) => void;
  onAddCustomer: () => void;
  products: Product[];
  lines: Line[];
  total: number;
  unitTotals: string;
  canCheckout: boolean;
  stockReady: boolean;
  stockError: string;
  isOnline: boolean;
  error: string;
  onRetryStock: () => void;
  available: (qualityId: string, locationId: string) => number;
  availableSacks?: (qualityId:string,locationId:string)=>number|undefined;
  used: (qualityId: string, locationId: string) => number;
  invalidLine: (line: Line) => boolean;
  savedPrice: (qualityId: string) => number;
  onAddProduct: (product: Product, qualityId: string) => void;
  onUpdateLine: (key: string, change: Partial<Line>) => void;
  onRemoveLine: (key: string) => void;
  onOpenPayment: () => void;
};

const number = (value: number) => value.toLocaleString("en-LK", {maximumFractionDigits: 3});

export function DetailedSalesEntry({center, customers, customerId, onCustomerChange, onAddCustomer,
  products, lines, total, unitTotals, canCheckout, stockReady, stockError, isOnline, error, onRetryStock, available, availableSacks, used, invalidLine,
  savedPrice, onAddProduct, onUpdateLine, onRemoveLine, onOpenPayment}: Props) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [showPicker, setShowPicker] = useState(true);
  const categories = useMemo(() => [...new Set(products.map(p => p.category?.trim() || "Uncategorized"))].sort(), [products]);
  const locations = (center?.locations ?? []).filter(l => l.is_active && (center?.allow_multiple_locations || l.is_default));
  const choices = useMemo<Choice[]>(() => products.flatMap(product => product.product_qualities
    .filter(quality => quality.is_active)
    .map(quality => ({product, quality}))), [products]);
  const filtered = choices.filter(({product, quality}) =>
    (category === "all" || (product.category?.trim() || "Uncategorized") === category) &&
    `${product.code} ${product.name} ${quality.name}`.toLowerCase().includes(search.toLowerCase().trim()));
  const grouped = useMemo(() => {
    const groups = new Map<string, {product: Product; qualityName: string; lines: Line[]}>();
    for (const line of lines) {
      const product = products.find(p => p.id === line.product_id);
      if (!product) continue;
      const key = `${line.product_id}:${line.quality_id}`;
      const group = groups.get(key) ?? {product, qualityName: product.product_qualities.find(q => q.id === line.quality_id)?.name ?? "Standard", lines: []};
      group.lines.push(line);
      groups.set(key, group);
    }
    return [...groups.values()];
  }, [lines, products]);

  return <main className="detail-purchase-scroll sales-detailed-scroll">
    <div className="detail-purchase-content">
      <header className="detail-purchase-heading">
        <div><span className="eyebrow dark">DETAILED SALES ORDER</span><h1>{showPicker ? "Select products" : "Enter sales quantities"}</h1>
          <p>Sales from the selected center and stock location. Available stock is checked before confirmation.</p></div>
        {lines.length > 0 && <button type="button" className="ghost" onClick={() => setShowPicker(!showPicker)}>{showPicker ? "View order" : "+ Add products"}</button>}
      </header>
      <section className="detail-party-section">
        <label>Customer
          <select aria-label="Detailed sale customer" value={customerId} onChange={e => onCustomerChange(e.target.value)}>
            <option value="">Walk-in customer (no credit)</option>
            {customers.filter(c => c.center_id === center?.id).map(c => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</option>)}
          </select>
        </label>
        <button type="button" className="ghost detail-add-farmer" disabled={!isOnline} title={!isOnline ? "Connect to add a customer" : ""} onClick={onAddCustomer}><UserPlus size={16}/> Add customer</button>
      </section>
      {error && <p className="alert error" role="alert">{error}</p>}
      {stockError && <div className="alert error" role="alert">{stockError} <button className="ghost" type="button" onClick={onRetryStock}>Retry stock</button></div>}
      {!stockReady && !stockError && <p role="status">Loading center stock…</p>}
      {stockReady && !locations.length && <p className="alert error">This center needs an active stock location.</p>}
      {showPicker && <section className="detail-product-picker">
        <h2>Products and qualities</h2>
        <label className="detail-product-search"><Search size={17}/><input aria-label="Search detailed sales products" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search product, code or quality"/></label>
        <div className="detail-categories"><button type="button" className={category === "all" ? "selected" : ""} onClick={() => setCategory("all")}>All</button>
          {categories.map(c => <button type="button" key={c} className={category === c ? "selected" : ""} onClick={() => setCategory(c)}>{c}</button>)}</div>
        <div className="detail-product-list sales-detail-products">
          {filtered.map(({product, quality}) => {
            const availableTotal = locations.reduce((sum, loc) => sum + Math.max(0, available(quality.id, loc.id) - used(quality.id, loc.id)), 0);
            return <button type="button" key={quality.id} className="detail-product-choice" disabled={!stockReady || availableTotal < .001} onClick={() => {onAddProduct(product, quality.id);setShowPicker(false);}}>
              <span><strong>{product.name}</strong><small>{product.code} · {quality.name} · {product.unit_of_measure}</small><small>{number(availableTotal)} available · {savedPrice(quality.id) ? money(savedPrice(quality.id)) : "Enter selling price"}</small></span>
              <b>{!stockReady ? "Checking…" : availableTotal < .001 ? "Out of stock" : "+ Add"}</b>
            </button>;
          })}
          {!filtered.length && <p className="detail-empty-products">No active products found.</p>}
        </div>
      </section>}
      {!showPicker && <section className="detail-weight-sections" aria-label="Detailed sale lines">
        {grouped.map(({product, qualityName, lines: groupLines}) => <article className="detail-product-group" key={`${product.id}:${groupLines[0].quality_id}`}>
          <header><div><strong>{product.name}</strong><small>{qualityName} · {product.unit_of_measure}</small></div>
            <strong>{money(groupLines.reduce((sum, line) => sum + cents(Number(line.quantity) * line.unit_price), 0) / 100)}</strong></header>
          <div className="sales-detail-rows">
            {groupLines.map((line, index) => <div key={line.key} className={`sales-detail-line${product.tracks_sacks?" sales-sack-line":""}${invalidLine(line) ? " sales-invalid" : ""}`}>
              <strong className="sales-detail-index">{index + 1}</strong>
              <label>Stock location<select value={line.location_id} aria-label={`Location for ${product.name} row ${index + 1}`} onChange={e => onUpdateLine(line.key, {location_id: e.target.value})}>
                <option value="">Select location</option>
                {locations.map(loc => <option key={loc.id} value={loc.id}>{loc.name} · {number(available(line.quality_id, loc.id))} {product.unit_of_measure}</option>)}
              </select></label>
              <label>Quantity ({product.unit_of_measure})<input aria-label={`Quantity for ${product.name} row ${index + 1}`} type="number" inputMode="decimal" min="0.001" step="0.001" value={line.quantity} onChange={e => onUpdateLine(line.key, {quantity: e.target.value})}/></label>
              {product.tracks_sacks&&<label>Sacks (available: {availableSacks?.(line.quality_id,line.location_id)??"not counted"}; 0 for loose)<input aria-label={"Sacks for "+product.name+" row "+(index+1)} type="number" min="0" step="1" required value={line.sack_count??""} onChange={e=>onUpdateLine(line.key,{sack_count:e.target.value===""?undefined:Number(e.target.value)})}/></label>}
              <label>Selling price (LKR)<input aria-label={`Selling price for ${product.name} row ${index + 1}`} type="number" inputMode="decimal" min="0.01" step="0.01" value={line.unit_price || ""} placeholder="Enter price" onChange={e => onUpdateLine(line.key, {unit_price: Number(e.target.value)})}/></label>
              <button type="button" title="Remove line" aria-label={`Remove ${product.name} row ${index + 1}`} onClick={() => onRemoveLine(line.key)}><Trash2 size={17}/></button>
              <small className="sales-detail-availability">Available: {number(available(line.quality_id, line.location_id))} {product.unit_of_measure}
                {invalidLine(line) && <b className="sales-line-error"> · Check stock, quantity and price</b>}</small>
            </div>)}
          </div>
          <button type="button" className="detail-add-row sales-detail-add" onClick={() => {
            // More rows for a given quality can be entered from the stock-aware product picker.
            setShowPicker(true);
          }}><Plus size={15}/> Add another product / location</button>
        </article>)}
        {!lines.length && <p className="detail-empty-weight">Select a product to start the sale.</p>}
      </section>}
      {lines.length > 0 && <footer className="detail-purchase-footer sales-detail-footer">
        <div><small>Total quantity · {unitTotals || "0"}</small><strong>{money(total)}</strong></div>
        <button type="button" className="primary" disabled={!canCheckout} onClick={onOpenPayment}>Continue to payment</button>
      </footer>}
    </div>
  </main>;
}
