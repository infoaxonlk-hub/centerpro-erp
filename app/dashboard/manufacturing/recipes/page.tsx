import {loadManufacturingOptions,loadManufacturingBoms} from '../data';
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requirePermission } from "@/lib/access";
import { ManufacturingRecipesManager } from "./recipes-manager";
import "../manufacturing.css";

export default async function ManufacturingRecipesPage(){
 const {supabase,profile}=await requirePermission("manufacturing","manufacturing");
 const [data,options]=await Promise.all([loadManufacturingBoms(supabase,profile.organization_id),loadManufacturingOptions(supabase,profile.organization_id)]);
 return <div className="manufacturing-page"><div className="page-heading"><div><span className="eyebrow dark">MANUFACTURING SETUP</span><h1>Bills of Materials</h1><p>Reusable finished-product, component, operation and by-product plans.</p></div><Link className="ghost" href="/dashboard/manufacturing"><ArrowLeft size={15}/> Production orders</Link></div><ManufacturingRecipesManager initialRecipes={data} products={options.products} centers={options.centers}/></div>;
}
