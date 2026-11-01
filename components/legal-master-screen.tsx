import {requirePermission} from "@/lib/access";
import {readAll} from "@/lib/read-all";
import type {LegalKind,LegalMaster} from "@/lib/legal-masters";
import {LegalMasterManager} from "./legal-master-manager";
import {legalText} from "@/lib/legal-messages";
export async function LegalMasterScreen({kind,services=false,masters=false}:{kind:LegalKind;services?:boolean;masters?:boolean}){
 const {supabase:s,profile}=await requirePermission(kind==="business"?"users":kind==="supplier"?(masters?"masters":"purchases"):services?"farm_services":"sales");
 const canCreate=["admin","super_admin"].includes(profile.role);
 if(kind==="business"){
  const {data,error}=await s.rpc("read_legal_master",{p_kind:kind,p_id:profile.organization_id});
  if(error)return <p className="alert error">{legalText("en","loadFailed")}</p>;
  return <LegalMasterManager kind={kind} initialRows={[]} centers={[]} canCreate={false} initialMaster={data as LegalMaster}/>;
 }
 const rows=await readAll<{id:string;name:string;center_id?:string}>(s,kind==="supplier"?"suppliers":"customers",kind==="supplier"?"id,name":"id,name,center_id",profile.organization_id);
 const centers=kind==="customer"?await readAll<{id:string;name:string;code:string;is_active:boolean}>(s,"centers","id,name,code,is_active",profile.organization_id):[];
 return <LegalMasterManager kind={kind} initialRows={rows.sort((a,b)=>a.name.localeCompare(b.name))} centers={centers.filter(c=>c.is_active)} canCreate={canCreate}/>;
}
