import type {SupabaseClient} from "@supabase/supabase-js";
import {readAll} from "@/lib/read-all";
import type {Center,Product,Lot,Recipe,Supplier} from "./manufacturing-order-form";
export async function loadManufacturingOptions(client:SupabaseClient,organizationId:string){
 const [centers,products,recipes,suppliers]=await Promise.all([
  readAll<Center&{is_active:boolean}>(client,"centers","id,code,name,is_active,locations(id,code,name,is_default,is_active)",organizationId),
  readAll<Product&{is_active:boolean}>(client,"products","id,code,name,category,unit_of_measure,product_type,can_be_sold,can_be_purchased,can_be_manufactured,tracks_sacks,is_active,product_qualities(id,name,default_price,is_active)",organizationId),
  readAll<Recipe&{is_active:boolean}>(client,"manufacturing_recipes","id,recipe_code,name,process_type,rice_variety,operation_name,operation_cost_basis,operation_cost_rate,external_mill_fee_per_kg,is_active",organizationId),
  readAll<Supplier&{is_active:boolean}>(client,"suppliers","id,name,phone,is_active",organizationId),
 ]);
 const lots:Lot[]=[];
 for(let offset=0;;offset+=500){const{data,error}=await client.rpc("stock_lot_balances").range(offset,offset+499);if(error)throw new Error("Stock lots could not be loaded: "+error.message);lots.push(...(data??[]));if((data??[]).length<500)break;}
 return{centers:centers.filter(c=>c.is_active).map(c=>({...c,locations:c.locations.filter(l=>l.is_active)})),products:products.filter(p=>p.is_active&&p.product_type!=="service"),recipes:recipes.filter(r=>r.is_active),suppliers:suppliers.filter(s=>s.is_active),lots};
}
