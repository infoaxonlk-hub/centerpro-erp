import Link from "next/link";
import "@/app/report-date-ranges.css";
import {requirePermission} from "@/lib/access";
import {dateRange} from "@/lib/report-dates";
export default async function AuditPage({searchParams}:{searchParams:Promise<{from?:string;to?:string;page?:string}>}){
 const {supabase:s}=await requirePermission("audit");const params=await searchParams;const {from,to,start,end}=dateRange(params);const page=Math.max(1,Math.min(10000,Number.parseInt(params.page??"1",10)||1));
 let query=s.from("audit_logs").select("id,action,entity_type,entity_id,after_data,created_at,profiles(full_name)",{count:"exact"}).order("created_at",{ascending:false}).order("id",{ascending:false});
 if(start)query=query.gte("created_at",start);if(end)query=query.lt("created_at",end);
 const {data:rows,error,count}=await query.range((page-1)*100,page*100-1);if(error)throw new Error(error.message);
 const href=(next:number)=>`/dashboard/audit?from=${from}&to=${to}&page=${next}`;
 return <><div className="page-heading"><div><span className="eyebrow dark">TRACEABILITY</span><h1>Audit history</h1><p>History of important system activity.</p></div></div>
 <form className="panel report-date-form" method="get"><label>From<input type="date" name="from" defaultValue={from}/></label><label>To<input type="date" name="to" defaultValue={to}/></label><button className="primary">Apply dates</button><Link className="ghost" href="/dashboard/audit">Clear</Link></form>
 <section className="panel table-panel"><p>{count??0} record(s) · page {page}</p><table><thead><tr><th>Date</th><th>User</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead><tbody>{(rows??[]).map(r=>{const p=Array.isArray(r.profiles)?r.profiles[0]:r.profiles;return <tr key={r.id}><td>{new Date(r.created_at).toLocaleString("en-LK",{timeZone:"Asia/Colombo"})}</td><td>{p?.full_name||"System"}</td><td><span className="status active">{r.action}</span></td><td>{r.entity_type}<small>{r.entity_id||""}</small></td><td><code>{r.after_data?JSON.stringify(r.after_data):"—"}</code></td></tr>})}{!rows?.length&&<tr><td colSpan={5} className="table-empty">No audit records in this date range.</td></tr>}</tbody></table><div className="report-date-pages">{page>1&&<Link className="ghost" href={href(page-1)}>Previous</Link>}{page*100<(count??0)&&<Link className="ghost" href={href(page+1)}>Next</Link>}</div></section></>;
}
