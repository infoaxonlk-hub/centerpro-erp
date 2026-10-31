"use client";
import { permissionsForModules } from "@/lib/business-modules";

type Administrator = { id:string;full_name:string;email:string;role?:string;is_active:boolean;permissions?:string[] };
const permissionLabels:Record<string,string>={
 dashboard:"Dashboard",purchases:"Purchases",sales:"Sales",stock:"Inventory / Stock",stock_adjustment:"Stock adjustments",manufacturing:"Manufacturing",farm_services:"Services",farm_services_manage:"Manage service products",
 labor:"Labor & Sessions",cash:"Cash, bank and expenses",payment_reports:"Payment reports",centers:"Centers & Locations",
 masters:"Products & Suppliers",product_create:"Create products",product_edit:"Edit products",users:"Users & Access",audit:"Audit Log",
};
export function BusinessAdminAccess({admins,enabledModules,disabled,onGrant}:{admins:Administrator[];enabledModules:readonly string[];disabled:boolean;onGrant:(admin:Administrator)=>void}) {
 const required=permissionsForModules(enabledModules);
 return <section className="business-admin-access"><h3>Administrator access</h3>
  <p>Business modules and user permissions are separate. Grant access below when an existing administrator cannot see newly enabled modules.</p>
  <p>This action uses the saved business modules. Save module changes first.</p>
  {!admins.length&&<p>No business administrators found.</p>}
  {admins.map(admin=>{
    const missing=admin.role==="super_admin"?[]:required.filter(permission=>!(admin.permissions??[]).includes(permission));
    return <article className="business-admin-access-card" key={admin.id}>
      <div><strong>{admin.full_name}</strong><small>{admin.email}</small></div>
      {!admin.is_active?<p>This administrator is inactive.</p>:admin.role==="super_admin"?<p>Super Admin already has all user permissions. Enable the required modules on this business and keep its subscription active; no administrator grant is needed for this account.</p>:missing.length?
        <p>Missing access: {missing.map(permission=>permissionLabels[permission]??permission).join(", ")}.</p>:
        <p>All enabled-module permissions are assigned.</p>}
      <button type="button" className="ghost" disabled={disabled||!admin.is_active||!missing.length} onClick={()=>onGrant(admin)}>
        Grant enabled-module access
      </button>
    </article>;
  })}
 </section>;
}
