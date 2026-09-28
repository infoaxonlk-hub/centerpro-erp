import {redirect} from "next/navigation";
import {requirePermission} from "@/lib/access";
import {ReturnRequestQueue} from "./queue";

export default async function ReturnsPage(){
 const {supabase:s,profile}=await requirePermission("dashboard");
 if(!["admin","super_admin"].includes(profile.role))redirect("/dashboard?error=Access denied");
 const {data,error}=await s.from("bill_returns").select("id,bill_type,bill_id,bill_number,reason,total_amount,applied_to_due,unapplied_credit,status,requested_at,review_note,centers(code,name),profiles!bill_returns_requested_by_fkey(full_name),bill_return_lines(product_name,quality_name,unit,quantity,line_total)").order("requested_at",{ascending:false}).limit(250);
 if(error)throw new Error(error.message);
 return <ReturnRequestQueue requests={data??[]}/>;
}
