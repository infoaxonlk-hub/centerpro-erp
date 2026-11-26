"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Save, ArrowLeft } from "lucide-react";
import { savePlant } from "./actions";

export type PlantFormValues = {
  id?: string;
  customer_id: string;
  plant_code?: string;
  serial_number?: string | null;
  plant_type: string;
  manufacturer?: string | null;
  model?: string | null;
  capacity?: number | string | null;
  capacity_unit?: string | null;
  installation_date?: string | null;
  site_address: string;
  status: string;
  notes?: string | null;
};
export type CustomerOption = { id: string; name: string; center_id: string; center_label: string };

export function PlantForm({ plant, customers }: { plant?: PlantFormValues; customers: CustomerOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const isEdit = Boolean(plant?.id);

  function submit(form: FormData) {
    setError("");
    startTransition(async () => {
      const result = await savePlant(form);
      if (result.error) { setError(result.error); return; }
      if (result.plantId) router.push(`/dashboard/water-treatment/${result.plantId}`);
      router.refresh();
    });
  }

  return <form action={submit} className="panel wt-form-panel">
    <input type="hidden" name="plant_id" value={plant?.id ?? ""}/>
    <div className="wt-form-section"><div><h2>Customer and plant</h2><p>The plant center follows its customer and is checked again when saved.</p></div>
      <div className="wt-form-grid">
        <label className="wt-wide">Customer<select name="customer_id" defaultValue={plant?.customer_id ?? ""} required><option value="" disabled>Select an authorized customer</option>{customers.map(customer=><option value={customer.id} key={customer.id}>{customer.name} · {customer.center_label}</option>)}</select></label>
        <label>Plant Code<input value={plant?.plant_code ?? "Generated when saved"} readOnly aria-readonly="true"/></label>
        <label>Plant Type<input name="plant_type" defaultValue={plant?.plant_type ?? ""} maxLength={100} required placeholder="e.g. Reverse osmosis"/></label>
        <label>Serial Number <span className="wt-optional">Optional</span><input name="serial_number" defaultValue={plant?.serial_number ?? ""} maxLength={200}/></label>
        <label>Manufacturer<input name="manufacturer" defaultValue={plant?.manufacturer ?? ""} maxLength={200}/></label>
        <label>Model<input name="model" defaultValue={plant?.model ?? ""} maxLength={200}/></label>
        <label>Capacity<input name="capacity" type="number" min="0.001" step="0.001" defaultValue={plant?.capacity ?? ""} inputMode="decimal"/></label>
        <label>Capacity Unit<input name="capacity_unit" defaultValue={plant?.capacity_unit ?? ""} list="wt-capacity-units" maxLength={40} placeholder="e.g. L/day"/><datalist id="wt-capacity-units"><option value="L/day"/><option value="m³/day"/><option value="GPD"/><option value="L/hour"/></datalist></label>
        <label>Installation Date<input name="installation_date" type="date" defaultValue={plant?.installation_date ?? ""}/></label>
        <label>Status<select name="status" defaultValue={plant?.status ?? "active"} required><option value="active">Active</option><option value="inactive">Inactive</option><option value="decommissioned">Decommissioned</option></select></label>
        <label className="wt-wide">Physical Site Address<textarea name="site_address" defaultValue={plant?.site_address ?? ""} maxLength={1000} rows={3} required placeholder="Installation location, access notes or directions"/></label>
        <label className="wt-wide">Notes <span className="wt-optional">Optional</span><textarea name="notes" defaultValue={plant?.notes ?? ""} maxLength={5000} rows={3}/></label>
      </div>
    </div>
    {customers.length === 0&&<p className="alert error" role="alert">No customers are available in your permitted centers. Ask an administrator to check your center access.</p>}
    {error&&<p className="alert error" role="alert">{error}</p>}
    <div className="wt-form-actions"><Link className="ghost" href={plant?.id ? `/dashboard/water-treatment/${plant.id}` : "/dashboard/water-treatment"}><ArrowLeft size={16}/> Cancel</Link><button className="primary" disabled={pending||customers.length===0}><Save size={16}/>{pending?"Saving…":isEdit?"Save changes":"Register plant"}</button></div>
  </form>;
}
