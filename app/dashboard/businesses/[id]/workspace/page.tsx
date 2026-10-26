import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { requireSuperAdmin, AccessError } from "@/lib/business-access";
import { inspectBusiness, inspectionSections, inspectionSectionSchema } from "@/lib/business-inspection";
import "../../businesses.css";
export default async function BusinessWorkspace({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{section?:string;offset?:string}>}) {
  try{await requireSuperAdmin();}catch{redirect("/dashboard?error=Access denied");}
  const id=z.string().uuid().safeParse((await params).id);
  if(!id.success)notFound();
  const query=await searchParams;
  const parsed=inspectionSectionSchema.safeParse(query.section??"overview");
  if(!parsed.success)notFound();
  const offset=z.coerce.number().int().min(0).max(1000000).catch(0).parse(query.offset??0);
  let result;
  try{result=await inspectBusiness(id.data,parsed.data,offset);}catch(error){if(error instanceof AccessError&&error.status===404)notFound();throw error;}
  const records=result.records as unknown as Record<string,unknown>[];
  const columns=records[0]?Object.keys(records[0]).filter(k=>k!=="organization_id"):[];
  const root="/dashboard/businesses/"+id.data+"/workspace";
  return <div className="business-portal"><div className="business-support-banner"><strong>READ-ONLY BUSINESS INSPECTION</strong>
    <h1>{result.business.name}</h1><p>Business ID: {id.data} Â· Status: {result.business.business_status}</p>
    <p>Inspection is separate from your own ERP workspace. Financial and inventory actions are unavailable here.</p>
    <Link className="ghost" href="/dashboard/businesses">Back to Businesses</Link></div>
    <nav className="business-tabs" aria-label="Inspect business modules">{Object.entries(inspectionSections).map(([key,definition])=>
      <Link key={key} className={key===parsed.data?"primary":"ghost"} href={root+"?section="+key}>{definition.label}</Link>)}</nav>
    <div className="metric-grid">{Object.entries(result.summary).map(([label,count])=><article className="metric" key={label}><span>{label}</span><strong>{count}</strong></article>)}</div>
    <section className="panel"><h2>{inspectionSections[parsed.data].label}</h2><p>{result.total} records Â· showing up to 50 per page</p>
      <div className="business-table-wrap"><table className="business-table"><thead><tr>{columns.map(key=><th key={key}>{key.replaceAll("_"," ")}</th>)}</tr></thead>
       <tbody>{records.map((row,index)=><tr key={String(row.id??index)}>{columns.map(key=><td key={key}>{displayValue(row[key])}</td>)}</tr>)}</tbody>
      </table>{!records.length&&<p>No records for this business in this section.</p>}</div>
      <p>{offset>0&&<Link className="ghost" href={root+"?section="+parsed.data+"&offset="+Math.max(0,offset-50)}>Previous</Link>}{" "}
       {offset+50<result.total&&<Link className="ghost" href={root+"?section="+parsed.data+"&offset="+(offset+50)}>Next</Link>}</p>
      <p>Snapshot lists are supported. POS, bill editing/printing, payment entry, stock mutations and operational report filters are not available in inspection mode.</p>
    </section></div>;
}
function displayValue(value:unknown):React.ReactNode {
  if(value===null||value===undefined)return "â€”";
  if(typeof value==="boolean")return value?"Yes":"No";
  if(Array.isArray(value))return <details><summary>{value.length} related records</summary>{value.map((item,index)=><dl key={index}>{Object.entries(item as Record<string,unknown>).map(([key,v])=><div key={key}><dt>{key.replaceAll("_"," ")}</dt><dd>{displayValue(v)}</dd></div>)}</dl>)}</details>;
  return String(value);
}
