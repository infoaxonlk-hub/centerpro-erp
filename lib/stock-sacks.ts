import type {SupabaseClient} from "@supabase/supabase-js";
import {readAll} from "@/lib/read-all";
export async function readStockSacks(client:SupabaseClient,organizationId:string){
 const rows=await readAll<{center_id:string;location_id:string;product_id:string;quality_id:string;delta:number}>(client,"stock_sack_movements","id,center_id,location_id,product_id,quality_id,delta",organizationId);
 const balances=new Map<string,number>();
 for(const row of rows){const key=[row.center_id,row.location_id,row.product_id,row.quality_id].join(":");balances.set(key,(balances.get(key)??0)+Number(row.delta));}
 return balances;
}
