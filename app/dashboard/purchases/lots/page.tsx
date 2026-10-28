import Link from "next/link";
import {requirePermission} from "@/lib/access";
import {PurchaseLotReceipts} from "@/components/purchase-lot-receipts";
import {lotReceiptColumns,mapLotReceipt} from "@/lib/purchase-lot-receipts";
export default async function LotReceiptsPage({searchParams}:{searchParams:Promise<{search?:string|string[];page?:string|string[]}>}){
 const params=await searchParams,search=(Array.isArray(params.search)?params.search[0]??"":params.search??"").trim().slice(0,80);
 const page=Math.max(1,Math.min(100000,Number.parseInt(String(params.page??"1"),10)||1)),pageSize=24;
 const {supabase,profile}=await requirePermission("purchases");
 let query=supabase.from("purchase_lot_receipts").select(lotReceiptColumns,{count:"exact"}).eq("organization_id",profile.organization_id);
 if(search)query=query.ilike("purchase_lots.lot_number",`%${search.replace(/[\\%_]/g,"\\$&")}%`);
 const {data,error,count}=await query.order("received_at",{ascending:false}).order("id").range((page-1)*pageSize,page*pageSize-1);
 if(error)throw new Error("Lot receipts could not be loaded: "+error.message);
 const pages=Math.max(1,Math.ceil((count??0)/pageSize));
 const href=(number:number)=>`/dashboard/purchases/lots?search=${encodeURIComponent(search)}&page=${number}`;
 return <><div className="page-heading"><div><span className="eyebrow dark">PURCHASE HISTORY</span><h1>Lot receipts</h1><p>Original received quantities and prices per receipt. These are not available stock balances.</p></div><Link className="ghost" href="/dashboard/purchases">Purchase orders</Link></div>
  <form className="panel lot-receipt-search" method="get"><label>Search lot / batch number<input name="search" defaultValue={search} maxLength={80} placeholder="Enter a lot number"/></label><button className="primary">Search</button>{search&&<Link className="ghost" href="/dashboard/purchases/lots">Clear</Link>}</form>
  <p>{count??0} receipt{count===1?"":"s"} · Page {page} of {pages}</p><PurchaseLotReceipts receipts={(data??[]).map(mapLotReceipt)}/>
  <nav className="lot-receipt-pagination" aria-label="Lot receipt pages">{page>1&&<Link className="ghost" href={href(page-1)}>Previous</Link>}{page<pages&&<Link className="ghost" href={href(page+1)}>Next</Link>}</nav>
 </>;
}
