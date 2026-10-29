import {requirePermission} from "@/lib/access";
import {ManufacturingOrderForm} from "../../manufacturing-order-form";
import {loadManufacturingOptions} from "../../data";
import "../../manufacturing.css";
export default async function NewManufacturingOrderPage({searchParams}:{searchParams:Promise<{process?:string|string[]}>}){
 const params=await searchParams;const requested=Array.isArray(params.process)?params.process[0]:params.process;
 const {supabase,profile}=await requirePermission("manufacturing","manufacturing");
 const options=await loadManufacturingOptions(supabase,profile.organization_id);
 return <ManufacturingOrderForm initialProcess={requested==="packing"?"packing":"milling"} {...options}/>;
}