import {readAll} from "@/lib/read-all";
import type {Recipe} from "./recipes-manager";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requirePermission } from "@/lib/access";
import { ManufacturingRecipesManager } from "./recipes-manager";
import "../manufacturing.css";

export default async function ManufacturingRecipesPage(){
 const {supabase,profile}=await requirePermission("manufacturing","manufacturing");
 const data=await readAll<Recipe>(supabase,"manufacturing_recipes","id,recipe_code,name,process_type,rice_variety,operation_name,operation_cost_basis,operation_cost_rate,external_mill_fee_per_kg,is_active,updated_at",profile.organization_id);
 return <div className="manufacturing-page"><div className="page-heading"><div><span className="eyebrow dark">MANUFACTURING SETUP</span><h1>Recipes / BoM</h1><p>Set reusable production operations and default labor or milling rates.</p></div><Link className="ghost" href="/dashboard/manufacturing"><ArrowLeft size={15}/> Production orders</Link></div><ManufacturingRecipesManager initialRecipes={data.filter(r=>r.is_active)}/></div>;
}
