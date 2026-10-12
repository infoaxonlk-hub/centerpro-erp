import type { SupabaseClient } from "@supabase/supabase-js";
/** Read every RLS-visible row; never show a silently truncated balance. */
export async function readAll<T>(client:SupabaseClient, table:string, columns:string, organizationId:string):Promise<T[]> {
  const rows:T[]=[];
  for(let offset=0;;offset+=500){
    const {data,error}=await client.from(table).select(columns).eq("organization_id",organizationId).order("id").range(offset,offset+499);
    if(error)throw new Error(`Could not load ${table}: ${error.message}`);
    rows.push(...(data as unknown as T[]));
    if(data.length<500)return rows;
  }
}
