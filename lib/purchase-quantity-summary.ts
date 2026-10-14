/** Format purchase quantities without adding unlike units (KG, PCS, L, etc.). */
export function formatPurchaseQuantityByUnit(
  lines: ReadonlyArray<{ product_id: string; quantity: number }>,
  products: ReadonlyArray<{ id: string; unit_of_measure: string }>,
): string {
  const unitById = new Map(products.map(p => [p.id, (p.unit_of_measure || "Units").trim() || "Units"]));
  const totals = new Map<string, number>();
  for (const line of lines) {
    const quantity = Number(line.quantity) || 0;
    if (!Number.isFinite(quantity)) continue;
    const unit = unitById.get(line.product_id) ?? "Units";
    const key = unit.toUpperCase();
    totals.set(key, (totals.get(key) ?? 0) + quantity);
  }
  return [...totals.entries()]
    .map(([unit, qty]) => `${qty.toLocaleString("en-LK", { maximumFractionDigits: 3 })} ${unit}`)
    .join(" · ") || "0";
}
