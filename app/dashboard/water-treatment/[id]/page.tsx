import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, ChevronLeft, ClipboardList, MapPin, Pencil, Plus } from "lucide-react";
import { requirePermission } from "@/lib/access";
import { readAll } from "@/lib/read-all";
import { PlantHistoryForm } from "../plant-history-form";

type CustomerRow = { id: string; name: string; phone: string | null; center_id: string };
type CenterRow = { id: string; code: string; name: string };
const types: Record<string, string> = { installation: "Installation", service: "Service", repair: "Repair", maintenance: "Maintenance", inspection: "Inspection" };
const date = (value: string) => new Date(value).toLocaleString("en-LK", { timeZone: "Asia/Colombo", dateStyle: "medium", timeStyle: "short" });

export default async function PlantDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase: s, profile } = await requirePermission("water_treatment", "water_treatment");
  const [{ data: plant, error }, customers, centers] = await Promise.all([
    s.from("water_treatment_plants").select("id,organization_id,customer_id,center_id,plant_code,serial_number,plant_type,manufacturer,model,capacity,capacity_unit,installation_date,site_address,status,notes,created_at,updated_at").eq("id", id).eq("organization_id", profile.organization_id).maybeSingle(),
    readAll<CustomerRow>(s, "customers", "id,name,phone,center_id", profile.organization_id),
    readAll<CenterRow>(s, "centers", "id,code,name", profile.organization_id),
  ]);
  if (error) throw new Error("Plant could not be loaded.");
  if (!plant) notFound();
  const customer = customers.find(row => row.id === plant.customer_id);
  if (!customer) notFound();
  const center = centers.find(row => row.id === plant.center_id);
  // Load only this plant's history, with the same RLS and tenant filters.
  const historyRows: { id: string; record_type: string; occurred_at: string; summary: string; details: string | null; next_service_date: string | null; created_at: string }[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error: historyError } = await s.from("water_treatment_plant_history").select("id,record_type,occurred_at,summary,details,next_service_date,created_at").eq("organization_id", profile.organization_id).eq("plant_id", id).order("occurred_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + 499);
    if (historyError) throw new Error("Plant history could not be loaded.");
    historyRows.push(...(data ?? []));
    if ((data ?? []).length < 500) break;
  }

  return <>
    <div className="wt-back-link"><Link href="/dashboard/water-treatment"><ChevronLeft size={16}/> Plant registry</Link></div>
    <header className="page-heading wt-detail-heading"><div><span className="eyebrow dark">WATER TREATMENT · {center ? `${center.code} · ${center.name}` : "PERMITTED CENTER"}</span><h1>{plant.plant_code}</h1><p>{customer.name}{plant.serial_number ? ` · Serial ${plant.serial_number}` : ""}</p></div><Link className="soft" href={`/dashboard/water-treatment/${id}/edit`}><Pencil size={16}/> Edit plant</Link></header>
    <section className="wt-detail-grid">
      <article className="panel wt-detail-card"><div className="wt-section-heading"><div><h2>Plant details</h2><p>Equipment and installation location</p></div><span className={`wt-status wt-status-${plant.status}`}>{plant.status.replaceAll("_", " ")}</span></div>
        <dl className="wt-detail-list">
          <div><dt>Customer</dt><dd>{customer.name}{customer.phone&&<small>{customer.phone}</small>}</dd></div>
          <div><dt>Plant Code</dt><dd>{plant.plant_code}</dd></div>
          <div><dt>Serial Number</dt><dd>{plant.serial_number||"—"}</dd></div>
          <div><dt>Plant Type</dt><dd>{plant.plant_type}</dd></div>
          <div><dt>Manufacturer / Model</dt><dd>{[plant.manufacturer,plant.model].filter(Boolean).join(" · ")||"—"}</dd></div>
          <div><dt>Capacity</dt><dd>{plant.capacity===null?"—":`${Number(plant.capacity).toLocaleString("en-LK")} ${plant.capacity_unit}`}</dd></div>
          <div><dt>Installation Date</dt><dd>{plant.installation_date||"—"}</dd></div>
          <div className="wt-detail-wide"><dt>Physical Site Address</dt><dd className="wt-address"><MapPin size={16}/>{plant.site_address}</dd></div>
          <div className="wt-detail-wide"><dt>Notes</dt><dd>{plant.notes||"—"}</dd></div>
        </dl>
      </article>
      <aside className="panel wt-history-add"><div className="wt-section-heading"><div><h2>Add history</h2><p>History records cannot be edited or deleted.</p></div><Plus size={20}/></div><PlantHistoryForm plantId={plant.id}/></aside>
    </section>
    <section className="panel wt-history-panel"><div className="wt-section-heading"><div><h2><ClipboardList size={19}/> Plant history</h2><p>Service and inspection records, newest first</p></div></div>
      {historyRows?.length ? <ol className="wt-history-list">{historyRows.map(row=><li key={row.id}><div className="wt-history-date"><CalendarDays size={15}/><time dateTime={row.occurred_at}>{date(row.occurred_at)}</time><span>{types[row.record_type]??row.record_type}</span></div><h3>{row.summary}</h3>{row.details&&<p>{row.details}</p>}{row.next_service_date&&<small className="wt-next-service">Next service: {row.next_service_date}</small>}<small className="wt-recorded-at">Recorded {date(row.created_at)}</small></li>)}</ol> : <div className="wt-empty wt-history-empty"><ClipboardList size={24}/><strong>No history recorded</strong><p>Add an installation, service, repair, maintenance or inspection record.</p></div>}
    </section>
  </>;
}
