import {redirect} from "next/navigation";
import {requirePermission} from "@/lib/access";
import {BillRequestQueue} from "./queue";
export default async function BillRequestsPage(){const {supabase:s,profile}=await requirePermission("dashboard");if(!["admin","super_admin"].includes(profile.role))redirect("/dashboard?error=Access denied");
 const {data,error}=await s.from("bill_cancel_requests").select("id,bill_type,bill_id,reason,status,requested_at,review_note,centers(code,name),profiles!bill_cancel_requests_requested_by_fkey(full_name)").order("requested_at",{ascending:false}).limit(200);
 if(error)throw new Error(error.message);return <BillRequestQueue requests={data??[]}/>}
