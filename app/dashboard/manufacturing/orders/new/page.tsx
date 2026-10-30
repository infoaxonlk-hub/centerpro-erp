import {requirePermission} from "@/lib/access";
import {ManufacturingOrderForm} from "../../manufacturing-order-form";
import {loadManufacturingOptions,loadManufacturingBoms} from "../../data";
import {BomManufacturingOrderForm} from '../../bom-order-form';
import "../../manufacturing.css";
export default async function NewManufacturingOrderPage({searchParams}:{searchParams:Promise<{process?:string|string[];legacy?:string}>}){
 const params=await searchParams;const requested=Array.isArray(params.process)?params.process[0]:params.process;
 const {supabase,profile}=await requirePermission("manufacturing","manufacturing");
 const options=await loadManufacturingOptions(supabase,profile.organization_id);
 if(params.legacy==='1')return <ManufacturingOrderForm initialProcess={requested==="packing"?"packing":"milling"} {...options}/>;
 const boms=await loadManufacturingBoms(supabase,profile.organization_id);
 return <BomManufacturingOrderForm initialProcess={requested==="packing"?"packing":"milling"} boms={boms} {...options}/>;
}
