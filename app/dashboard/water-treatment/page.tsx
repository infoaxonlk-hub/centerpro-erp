import Link from "next/link";
import { Plus, Droplets } from "lucide-react";
import { requirePermission } from "@/lib/access";
import { readAll } from "@/lib/read-all";
import { WaterTreatmentPlantList, type PlantListRow } from "./plants";

type CustomerRow = { id: string; name: string; center_id: string };
type CenterRow = { id: string; code: string; name: string };

export default async function WaterTreatmentPage() {
  const { supabase: s, profile } = await requirePermission("water_treatment", "water_treatment");
  const [plants, customers, centers] = await Promise.all([
    readAll<PlantListRow>(s, "water_treatment_plants", "id,customer_id,center_id,plant_code,serial_number,plant_type,manufacturer,model,capacity,capacity_unit,installation_date,status,site_address,updated_at", profile.organization_id),
    readAll<CustomerRow>(s, "customers", "id,name,center_id", profile.organization_id),
    readAll<CenterRow>(s, "centers", "id,code,name", profile.organization_id),
  ]);
  const customerNames = new Map(customers.map(customer => [customer.id, customer.name]));
  const centerLabels = new Map(centers.map(center => [center.id, `${center.code} · ${center.name}`]));
  const rows = plants.map(plant => ({
    ...plant,
    customer_name: customerNames.get(plant.customer_id) ?? "Customer unavailable",
    center_label: centerLabels.get(plant.center_id) ?? "Permitted center",
  }));

  return <>
    <header className="page-heading wt-page-heading">
      <div><span className="eyebrow dark">OPERATIONS</span><h1>Water Treatment Plants</h1><p>Register customer equipment and keep its service history together.</p></div>
      <Link className="primary wt-add-link" href="/dashboard/water-treatment/new"><Plus size={17}/> Add plant</Link>
    </header>
    <section className="panel wt-list-panel">
      <div className="wt-section-heading"><div><h2>Plant registry</h2><p>{rows.length} plant{rows.length === 1 ? "" : "s"} in your permitted centers</p></div><Droplets className="wt-heading-icon" size={22}/></div>
      <WaterTreatmentPlantList rows={rows}/>
    </section>
  </>;
}
