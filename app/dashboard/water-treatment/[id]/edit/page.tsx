import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requirePermission } from "@/lib/access";
import { readAll } from "@/lib/read-all";
import { PlantForm, type CustomerOption, type PlantFormValues } from "../../plant-form";

type CustomerRow = { id: string; name: string; center_id: string };
type CenterRow = { id: string; code: string; name: string };

export default async function EditPlantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase: s, profile } = await requirePermission("water_treatment", "water_treatment");
  const [{ data: plant, error }, customers, centers] = await Promise.all([
    s.from("water_treatment_plants").select("id,customer_id,plant_code,serial_number,plant_type,manufacturer,model,capacity,capacity_unit,installation_date,site_address,status,notes").eq("id", id).eq("organization_id", profile.organization_id).maybeSingle(),
    readAll<CustomerRow>(s, "customers", "id,name,center_id", profile.organization_id),
    readAll<CenterRow>(s, "centers", "id,code,name", profile.organization_id),
  ]);
  if (error) throw new Error("Plant could not be loaded.");
  if (!plant) notFound();
  const centerLabels = new Map(centers.map(center => [center.id, `${center.code} · ${center.name}`]));
  const options: CustomerOption[] = customers.map(customer => ({ ...customer, center_label: centerLabels.get(customer.center_id) ?? "Permitted center" }));
  if (!options.some(customer => customer.id === plant.customer_id)) notFound();
  const values: PlantFormValues = { ...plant, capacity: plant.capacity === null ? null : Number(plant.capacity) };
  return <>
    <div className="wt-back-link"><Link href={`/dashboard/water-treatment/${id}`}><ChevronLeft size={16}/> Plant details</Link></div>
    <header className="page-heading"><div><span className="eyebrow dark">PLANT REGISTRY · {plant.plant_code}</span><h1>Edit plant</h1><p>Plant code and audit fields are managed by the system.</p></div></header>
    <PlantForm plant={values} customers={options}/>
  </>;
}
