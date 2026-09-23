"use client";

import { useState } from "react";
import { Download, Upload, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { notify } from "@/components/feedback";

type Row = { code: string; name: string; category_code: string; category_name: string; unit: string; global_price: string };
type Category = { code: string; name: string };
const columns = ["code", "name", "category_code", "category_name", "unit", "global_price"] as const;

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, afterQuote = false;
  const source = input.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') { quoted = false; afterQuote = true; }
      else field += ch;
    } else if (afterQuote) {
      if (ch === "," || ch === "\n" || ch === "\r") { afterQuote = false; i--; }
      else if (ch !== " " && ch !== "\t") throw new Error(`Invalid CSV quote near row ${rows.length + 1}`);
    } else if (ch === '"') {
      if (field.trim()) throw new Error(`Invalid CSV quote near row ${rows.length + 1}`);
      quoted = true;
    } else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (quoted) throw new Error("CSV has an unclosed quoted value");
  if (field || row.length) { row.push(field); if (row.some(value => value.trim())) rows.push(row); }
  return rows;
}

function validate(content: string, existingCodes: string[], categories: Category[]): Row[] {
  const csv = parseCsv(content);
  if (!csv.length || csv[0].map(v => v.trim().toLowerCase()).join(",") !== columns.join(",")) {
    throw new Error(`CSV header must be: ${columns.join(",")}`);
  }
  if (csv.length < 2 || csv.length > 501) throw new Error("Include 1 to 500 product rows per file");
  const seen = new Set(existingCodes.map(v => v.toUpperCase()));
  const categoryCodes = new Map(categories.map(c => [c.code.toUpperCase(), c.name.toLowerCase()]));
  const categoryNames = new Map(categories.map(c => [c.name.toLowerCase(), c.code.toUpperCase()]));
  return csv.slice(1).map((values, index) => {
    const line = index + 2;
    if (values.length !== columns.length) throw new Error(`Row ${line}: expected ${columns.length} columns`);
    const [rawCode, rawName, rawCategoryCode, rawCategoryName, rawUnit, price] = values.map(v => v.trim());
    const code = rawCode.toUpperCase(), category_code = rawCategoryCode.toUpperCase(), unit = rawUnit.toUpperCase();
    if (!code || code.length > 50 || !rawName || rawName.length > 200) throw new Error(`Row ${line}: code/name required (max 50/200 characters)`);
    if (seen.has(code)) throw new Error(`Row ${line}: product code ${code} already exists or repeats`);
    seen.add(code);
    if (!(["KG", "G", "UNIT"].includes(unit))) throw new Error(`Row ${line}: unit must be KG, G or UNIT`);
    if (!!category_code !== !!rawCategoryName || category_code.length > 50 || rawCategoryName.length > 200) throw new Error(`Row ${line}: provide both category code and name, or leave both blank`);
    if (category_code) {
      if (categoryCodes.has(category_code) && categoryCodes.get(category_code) !== rawCategoryName.toLowerCase()) throw new Error(`Row ${line}: category code has a different name`);
      if (categoryNames.has(rawCategoryName.toLowerCase()) && categoryNames.get(rawCategoryName.toLowerCase()) !== category_code) throw new Error(`Row ${line}: category name has a different code`);
      categoryCodes.set(category_code, rawCategoryName.toLowerCase());
      categoryNames.set(rawCategoryName.toLowerCase(), category_code);
    }
    if (!/^[0-9]{1,16}(\.[0-9]{1,2})?$/.test(price)) throw new Error(`Row ${line}: invalid global purchase price`);
    return { code, name: rawName, category_code, category_name: rawCategoryName, unit, global_price: price };
  });
}

export function ProductImport({ products, categories, onImported }: {
  products: { code: string }[]; categories: Category[]; onImported: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [filename, setFilename] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function downloadTemplate() {
    const blob = new Blob([columns.join(",") + "\r\n"], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = "centerpro-products-template.csv"; link.click();
    URL.revokeObjectURL(url);
  }
  async function chooseFile(file?: File) {
    setRows([]); setFilename(file?.name ?? ""); setError("");
    if (!file) return;
    if (file.size > 1024 * 1024) { setError("CSV file must be 1 MB or smaller"); return; }
    try { setRows(validate(await file.text(), products.map(p => p.code), categories)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not read CSV"); }
  }
  async function importRows() {
    if (!rows.length || busy) return;
    setBusy(true); setError("");
    const { data, error: failure } = await createClient().rpc("import_products", { p_rows: rows });
    if (failure) { setError(failure.message); notify(failure.message, "error"); setBusy(false); return; }
    await onImported();
    setBusy(false); setOpen(false); setRows([]); setFilename("");
    notify(`${data} products imported successfully`);
  }
  return <>
    <button className="soft" onClick={() => { setOpen(true); setError(""); }}><Upload size={16}/> Import CSV</button>
    {open && <div className="dialog-backdrop"><div className="dialog" role="dialog" aria-modal="true" aria-label="Import products">
      <div className="dialog-head"><div><h2>Import products</h2><p>Review the CSV before creating products and categories.</p></div><button className="icon-btn" aria-label="Close" onClick={() => !busy && setOpen(false)}><X/></button></div>
      <p className="form-help">Columns: code, name, category_code, category_name, unit, global_price. Category columns may both be blank. Units: KG, G, UNIT. Existing product codes stop the entire import.</p>
      <button className="soft" onClick={downloadTemplate}><Download size={16}/> Download CSV template</button>
      <label className="wide" style={{display:"block",marginTop:16}}>Select CSV file (up to 500 rows)
        <input type="file" accept=".csv,text/csv" onChange={e => chooseFile(e.target.files?.[0])} />
      </label>
      {error && <div className="alert error" role="alert">{error}</div>}
      {!!rows.length && <><p><strong>{rows.length} products ready</strong> from {filename}. New categories will be created automatically.</p>
        <div style={{maxHeight:240,overflow:"auto"}} className="table-panel"><table><thead><tr><th>Code</th><th>Name</th><th>Category</th><th>Unit</th><th>Price</th></tr></thead><tbody>
          {rows.slice(0, 20).map(row => <tr key={row.code}><td>{row.code}</td><td>{row.name}</td><td>{row.category_name || "—"}</td><td>{row.unit}</td><td>{row.global_price}</td></tr>)}
        </tbody></table></div>{rows.length > 20 && <small>Showing first 20 rows of {rows.length}.</small>}</>}
      <div className="dialog-actions"><button className="ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel</button><button className="primary" disabled={!rows.length || busy} onClick={importRows}>{busy ? "Importing…" : `Import ${rows.length} products`}</button></div>
    </div></div>}
  </>;
}
