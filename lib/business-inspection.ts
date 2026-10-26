import { z } from "zod";
import { requireSuperAdmin } from "@/lib/business-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { readPlatformBusiness } from "@/lib/platform-businesses";

export const inspectionSections = {
 overview: {label:"Overview",table:"centers",select:"id,code,name,is_active,created_at"},
 purchases: {label:"Purchases",table:"purchase_orders",select:"id,po_number,status,total_amount,payment_status,created_at,purchase_order_lines(id,quantity,actual_price,line_total)"},
 sales: {label:"Sales",table:"sales_orders",select:"id,sale_number,customer_name,total_amount,paid_amount,credit_balance,status,confirmed_at,sales_order_lines(id,product_name,quality_name,quantity,unit_price,line_total)"},
 inventory: {label:"Inventory movements",table:"stock_movements",select:"id,center_id,location_id,product_id,movement_type,quantity,unit_cost,created_at"},
 transfers: {label:"Stock transfers",table:"stock_transfers",select:"id,transfer_number,created_at,stock_transfer_lines(id,quantity)"},
 adjustments: {label:"Stock adjustments",table:"stock_adjustments",select:"id,center_id,product_id,created_at"},
 labor: {label:"Labor sessions",table:"labor_sessions",select:"id,title,session_date,status,created_at"},
 cash: {label:"Cash ledger",table:"cash_ledger",select:"id,center_id,movement_type,amount,note,created_at"},
 bank: {label:"Bank accounts",table:"bank_accounts",select:"id,account_number,branch_name,is_active,created_at"},
 expenses: {label:"Expenses",table:"expenses",select:"id,center_id,payee,amount,method,expense_date,created_at"},
 payments: {label:"Payments & cheques",table:"payments",select:"id,center_id,method,amount,reference,cheque_number,cheque_status,created_at"},
 receivables: {label:"Customer receivables",table:"sales_invoices",select:"id,invoice_number,total_amount,outstanding_amount,status,created_at"},
 payables: {label:"Supplier payables",table:"supplier_payables",select:"id,original_amount,outstanding_amount,status,created_at"},
 centers: {label:"Centers & locations",table:"centers",select:"id,code,name,is_active,locations(id,code,name,is_active)"},
 masters: {label:"Products",table:"products",select:"id,code,name,unit_of_measure,is_active,product_qualities(id,name,default_price,is_active)"},
 users: {label:"Business users",table:"profiles",select:"id,full_name,email,role,is_active,created_at"},
 audit: {label:"Audit activity",table:"audit_logs",select:"id,action,entity_type,entity_id,created_at"},
} as const;
export type InspectionSection = keyof typeof inspectionSections;
export const inspectionSectionSchema = z.enum(Object.keys(inspectionSections) as [InspectionSection,...InspectionSection[]]);
export async function inspectBusiness(id:string,section:InspectionSection,offset=0) {
  const {user}=await requireSuperAdmin();
  const business=await readPlatformBusiness(z.string().uuid().parse(id));
  const admin=createAdminClient();
  const definition=inspectionSections[section];
  // Only allowlisted root tables have organization_id. Child arrays are selected
  // through these scoped parents, never queried independently without ownership.
  const {data,error,count}=await admin.from(definition.table).select(definition.select as string,{count:"exact"})
    .eq("organization_id",business.id).order("id",{ascending:false}).range(offset,offset+49);
  if(error)throw new Error("Business inspection data could not be loaded.");
  const {error:auditError}=await admin.from("audit_logs").insert({
    organization_id:business.id,actor_id:user.id,action:"business_workspace_inspected",entity_type:"organization",entity_id:business.id,
    after_data:{section,offset,read_only:true},
  });
  if(auditError)throw new Error("Business inspection audit could not be recorded.");
  const summary:Record<string,number>={};
  if(section==="overview") {
    const counters=[["Centers","centers"],["Products","products"],["Purchase orders","purchase_orders"],["Sales orders","sales_orders"],["Business users","profiles"]] as const;
    await Promise.all(counters.map(async([label,table])=>{
      const {count,error}=await admin.from(table).select("id",{count:"exact",head:true}).eq("organization_id",business.id);
      if(error)throw new Error("Business overview could not be loaded.");
      summary[label]=count??0;
    }));
  }
  return {business,section,records:data??[],total:count??0,offset,summary,readOnly:true};
}
