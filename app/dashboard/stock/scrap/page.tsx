import Link from "next/link";
import {redirect} from "next/navigation";
import {ArrowLeftRight,Boxes} from "lucide-react";
import {createClient} from "@/lib/supabase/server";
import {StockScrapForm,type ScrapBalance,type ScrapCenter} from "./scrap-form";
import "../stock-chart.css";

type Rel<T>=T|T[]|null;
const one=<T,>(value:Rel<T>)=>Array.isArray(value)?value[0]??null:value;
const money=new Intl.NumberFormat("en-LK",{style:"currency",currency:"LKR"});

export default async function StockScrapPage(){
 const s=await createClient();
 const {data:{user}}=await s.auth.getUser();
 if(!user)redirect("/login");
 const {data:profile}=await s.from("profiles").select("organization_id,role,is_active,permissions").eq("id",user.id).single();
 if(!profile?.is_active)redirect("/login?error=Your account is inactive");
 const canScrap=profile.role==="center_user"||profile.role==="super_admin"||(profile.role==="admin"&&(profile.permissions??[]).includes("stock"));
 if(!canScrap)redirect("/dashboard?error=Access denied");
 const [{data:centerRows,error:centerError},{data:scrapRows,error:scrapError}]=await Promise.all([
  s.from("centers").select("id,code,name,locations(id,code,name,is_active)").eq("is_active",true).order("name"),
  s.from("stock_scraps").select("id,scrap_number,center_label,location_label,reason,total_quantity,total_value,created_at,stock_scrap_lines(product_code,product_name,quality_name,unit,quantity,unit_cost,line_value)").order("created_at",{ascending:false}).limit(100),
 ]);
 if(centerError)throw new Error("Centers could not be loaded: "+centerError.message);
 if(scrapError)throw new Error("Scrap history could not be loaded: "+scrapError.message);
 const centers=(centerRows??[]).map(c=>({id:c.id,code:c.code,name:c.name,locations:(c.locations??[]).filter(l=>l.is_active).map(l=>({id:l.id,code:l.code,name:l.name}))})).filter(c=>c.locations.length>0) as ScrapCenter[];
 const movements:Awaited<ReturnType<typeof loadMovements>>["data"] extends (infer R)[]|null?R[]:never=[];
 function loadMovements(){return s.from("stock_movements").select("id,center_id,location_id,product_id,quality_id,movement_type,quantity,unit_cost,centers(name,code),locations(name,code),products(name,code,unit_of_measure),product_qualities(name)").order("created_at").order("id")}
 for(let offset=0;;offset+=500){const {data,error}=await loadMovements().range(offset,offset+499);if(error)throw new Error("Stock balances could not be loaded: "+error.message);movements.push(...data);if(data.length<500)break}
 const grouped=new Map<string,ScrapBalance>();
 for(const row of movements){
  const center=one(row.centers),location=one(row.locations),product=one(row.products),quality=one(row.product_qualities);
  const key=[row.center_id,row.location_id,row.product_id,row.quality_id].join(":");
  const balance=grouped.get(key)??{key,centerId:row.center_id,locationId:row.location_id,productId:row.product_id,qualityId:row.quality_id,centerLabel:`${center?.code??""} · ${center?.name??""}`,locationLabel:`${location?.code??""} · ${location?.name??""}`,productCode:product?.code??"",productName:product?.name??"",qualityName:quality?.name??"",unit:product?.unit_of_measure??"unit",quantity:0,value:0};
  const sign=["purchase_in","transfer_in","adjustment_in"].includes(row.movement_type)?1:-1;
  balance.quantity+=sign*Number(row.quantity);balance.value+=sign*Number(row.quantity)*Number(row.unit_cost);grouped.set(key,balance);
 }
 const balances=[...grouped.values()].filter(x=>x.quantity>0.0001).sort((a,b)=>a.productName.localeCompare(b.productName)||a.qualityName.localeCompare(b.qualityName));
 return <>
  <div className="page-heading"><div><span className="eyebrow dark">INVENTORY CONTROL</span><h1>Scrap stock</h1><p>Record damaged, expired or unusable stock and remove it from the available inventory.</p></div><div className="stock-scrap-heading-actions"><Link className="ghost" href="/dashboard/stock"><Boxes size={16}/> Stock explorer</Link><Link className="ghost" href="/dashboard/stock/transfers"><ArrowLeftRight size={16}/> Transfers</Link></div></div>
  <StockScrapForm centers={centers} balances={balances}/>
  <section className="panel table-panel stock-scrap-history"><div className="stock-transfer-history-heading"><div><span className="eyebrow dark">SCRAP RECORDS</span><h2>Recent stock scrap</h2></div><span>{scrapRows?.length??0} shown</span></div>
   <table><thead><tr><th>Scrap no.</th><th>Center / location</th><th>Item(s)</th><th>Reason</th><th className="number">Quantity</th><th className="number">Stock value</th><th>Date</th></tr></thead><tbody>{(scrapRows??[]).map(scrap=><tr key={scrap.id}><td><strong>{scrap.scrap_number}</strong></td><td>{scrap.center_label}<small>{scrap.location_label}</small></td><td>{scrap.stock_scrap_lines.map(line=>`${line.product_code} · ${line.product_name} · ${line.quality_name} (${Number(line.quantity).toLocaleString("en-LK",{maximumFractionDigits:3})} ${line.unit})`).join(", ")}</td><td>{scrap.reason}</td><td className="number">{Number(scrap.total_quantity).toLocaleString("en-LK",{maximumFractionDigits:3})}</td><td className="number">{money.format(Number(scrap.total_value))}</td><td>{new Date(scrap.created_at).toLocaleString("en-LK",{timeZone:"Asia/Colombo"})}</td></tr>)}{!scrapRows?.length&&<tr><td colSpan={7} className="table-empty">No stock scrap records yet.</td></tr>}</tbody></table>
  </section>
 </>;
}
