import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requirePermission } from "@/lib/access";
import { readAll } from "@/lib/read-all";
import { PlantForm, type CustomerOption } from "../plant-form";

type CustomerRow = { id: string; name: string; center_id: string };
type CenterRow = { id: string; code: string; name: string };

export default async function NewPlantPage() {
  const { supabase: s, profile } = await requirePermission("water_treatment", "water_treatment");
  const [customers, centers] = await Promise.all([
    readAll<CustomerRow>(s, "customers", "id,name,center_id", profile.organization_id),
    readAll<CenterRow>(s, "centers", "id,code,name", profile.organization_id),
  ]);
  const centerLabels = new Map(centers.map(center => [center.id, `${center.code} · ${center.name}`]));
  const options: CustomerOption[] = customers.map(customer => ({ ...customer, center_label: centerLabels.get(customer.center_id) ?? "Permitted center" }));
  return <>
    <div className="wt-back-link"><Link href="/dashboard/water-treatment"><ChevronLeft size={16}/> Plant registry</Link></div>
    <header className="page-heading"><div><span className="eyebrow dark">PLANT REGISTRY</span><h1>Register a plant</h1><p>Choose an authorized customer and enter the equipment and installation site details.</p></div></header>
    <PlantForm customers={options}/>
  </>;
}
