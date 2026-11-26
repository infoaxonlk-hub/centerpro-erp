"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, Droplets, MapPin, ChevronRight } from "lucide-react";

export type PlantListRow = {
  id: string;
  customer_id: string;
  center_id: string;
  plant_code: string;
  serial_number: string | null;
  plant_type: string;
  manufacturer: string | null;
  model: string | null;
  capacity: number | string | null;
  capacity_unit: string | null;
  installation_date: string | null;
  status: string;
  site_address: string;
  updated_at: string;
  customer_name: string;
  center_label: string;
};

const statusLabel: Record<string, string> = { active: "Active", inactive: "Inactive", decommissioned: "Decommissioned" };

export function WaterTreatmentPlantList({ rows }: { rows: PlantListRow[] }) {
  const [query, setQuery] = useState("");
  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return rows.filter(row => !normalized || [row.plant_code, row.serial_number, row.customer_name, row.plant_type, row.manufacturer, row.model, row.center_label, row.site_address].some(value => value?.toLocaleLowerCase().includes(normalized)));
  }, [query, rows]);

  return <>
    <label className="wt-search"><Search size={18}/><span className="sr-only">Search plants</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search code, serial number, customer or type"/></label>
    {visibleRows.length ? <>
      <div className="wt-plant-table-wrap"><table className="wt-plant-table"><thead><tr><th>Plant</th><th>Customer</th><th>Center</th><th>Type / Model</th><th>Status</th><th/></tr></thead><tbody>
        {visibleRows.map(row => <tr key={row.id}><td><Link href={`/dashboard/water-treatment/${row.id}`} className="wt-plant-code">{row.plant_code}</Link><small>{row.serial_number || "No serial number"}</small></td><td>{row.customer_name}</td><td>{row.center_label}</td><td>{[row.plant_type, row.manufacturer, row.model].filter(Boolean).join(" · ")}</td><td><span className={`wt-status wt-status-${row.status}`}>{statusLabel[row.status] ?? row.status}</span></td><td><Link className="wt-open-link" href={`/dashboard/water-treatment/${row.id}`} aria-label={`View ${row.plant_code}`}><ChevronRight size={18}/></Link></td></tr>)}
      </tbody></table></div>
      <div className="wt-plant-cards">{visibleRows.map(row => <Link href={`/dashboard/water-treatment/${row.id}`} className="wt-plant-card" key={row.id}>
        <div className="wt-plant-card-top"><span className="wt-card-icon"><Droplets size={18}/></span><span className={`wt-status wt-status-${row.status}`}>{statusLabel[row.status] ?? row.status}</span></div>
        <strong>{row.plant_code}</strong><span>{row.customer_name}</span><small>{[row.plant_type, row.manufacturer, row.model].filter(Boolean).join(" · ")}</small>
        <span className="wt-card-location"><MapPin size={14}/>{row.center_label}</span>
      </Link>)}</div>
    </> : <div className="wt-empty"><Droplets size={25}/><strong>{rows.length ? "No matching plants" : "No plants registered yet"}</strong><p>{rows.length ? "Try a different search term." : "Add a customer plant to start its service history."}</p>{!rows.length&&<Link className="soft" href="/dashboard/water-treatment/new">Register the first plant</Link>}</div>}
  </>;
}
