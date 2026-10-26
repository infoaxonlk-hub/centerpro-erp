import type {SupabaseClient} from "@supabase/supabase-js";
import {colomboDay} from "@/lib/report-dates";
import {stockDirection} from "@/lib/stock-summary";
import {readAll} from "@/lib/read-all";
export type DashboardScope={organizationId:string;purchases:boolean;sales:boolean;inventory:boolean;cash:boolean};
export type UnitStock={unit:string;quantity:number};
export type HighestStock={productId:string;product:string;code:string;unit:string;quantity:number};
export type DashboardSummary={
 day:string;todayPurchases:number|null;todayPurchaseCount:number|null;purchaseOrderCount:number|null;
 todaySales:number|null;todaySaleCount:number|null;stock:UnitStock[]|null;highestStock:HighestStock[]|null;
 centerCash:{total:number;centers:{id:string;name:string;balance:number}[]}|null;stockSacks?:number|null;
};
export function dashboardDayRange(now:Date){
 const day=colomboDay(now.toISOString()),start=new Date(day+"T00:00:00+05:30");
 return{day,start:start.toISOString(),end:new Date(start.getTime()+86400000).toISOString()};
}
type AmountRow={id:string;total_amount:number|string};
type ProductRow={id:string;product_id:string;quantity:number|string;movement_type:string;products:{name:string;code:string;unit_of_measure:string}|{name:string;code:string;unit_of_measure:string}[]|null};
type CashAccount={id:string;center_id:string;centers:{name:string;code:string}|{name:string;code:string}[]|null};
const one=<T,>(row:T|T[]|null)=>Array.isArray(row)?row[0]:row;
export async function readDashboardSummary(client:SupabaseClient,scope:DashboardScope,now:Date=new Date()):Promise<DashboardSummary>{
 const {day,start,end}=dashboardDayRange(now);
 async function amounts(table:"purchase_orders"|"sales_orders"){
  let total=0,count=0;
  for(let offset=0;;offset+=500){
   const {data,error}=await client.from(table).select("id,total_amount").eq("organization_id",scope.organizationId)
    .eq("status","confirmed").gte("confirmed_at",start).lt("confirmed_at",end).order("id").range(offset,offset+499);
   if(error)throw new Error("Today's "+(table==="purchase_orders"?"purchases":"sales")+" could not be loaded.");
   const rows=data as AmountRow[];for(const row of rows){total+=Number(row.total_amount);count++;}
   if(rows.length<500)return{total,count};
  }
 }
 async function stock(){
  const products=new Map<string,HighestStock>();
  for(let offset=0;;offset+=500){
   const {data,error}=await client.from("stock_movements").select("id,product_id,quantity,movement_type,products(name,code,unit_of_measure)")
    .eq("organization_id",scope.organizationId).order("id").range(offset,offset+499);
   if(error)throw new Error("Dashboard stock could not be loaded.");
   const rows=data as unknown as ProductRow[];
   for(const row of rows){
    const product=one(row.products),unit=product?.unit_of_measure??"unit",key=row.product_id+":"+unit;
    const item=products.get(key)??{productId:row.product_id,product:product?.name??"Unknown product",code:product?.code??"",unit,quantity:0};
    item.quantity+=stockDirection(row.movement_type)*Number(row.quantity);products.set(key,item);
   }
   if(rows.length<500)break;
  }
  const totals=new Map<string,number>(),highest=new Map<string,HighestStock>();
  for(const item of products.values()){
   totals.set(item.unit,(totals.get(item.unit)??0)+item.quantity);
   if(item.quantity>0&&(!highest.has(item.unit)||item.quantity>highest.get(item.unit)!.quantity||
     item.quantity===highest.get(item.unit)!.quantity&&item.product.localeCompare(highest.get(item.unit)!.product)<0))highest.set(item.unit,item);
  }
  const sackRows=await readAll<{delta:number}>(client,"stock_sack_movements","id,delta",scope.organizationId);
  return{sacks:sackRows.reduce((sum,row)=>sum+Number(row.delta),0),totals:[...totals].sort(([a],[b])=>a.localeCompare(b)).map(([unit,quantity])=>({unit,quantity})),
   highest:[...highest.values()].sort((a,b)=>a.unit.localeCompare(b.unit))};
 }
 async function centerCash(){
  const accounts:CashAccount[]=[];
  for(let offset=0;;offset+=500){
   const {data,error}=await client.from("cash_accounts").select("id,center_id,centers(name,code)")
    .eq("organization_id",scope.organizationId).eq("kind","center").order("id").range(offset,offset+499);
   if(error)throw new Error("Center cash accounts could not be loaded.");
   accounts.push(...data as unknown as CashAccount[]);if(data.length<500)break;
  }
  const centers:{id:string;name:string;balance:number}[]=[];
  for(let index=0;index<accounts.length;index+=10){
   const batch=await Promise.all(accounts.slice(index,index+10).map(async account=>{
    const {data,error}=await client.rpc("cash_account_balance",{p_account:account.id});
    if(error)throw new Error("A center cash balance could not be loaded.");
    const center=one(account.centers);
    return{id:account.center_id,name:center?center.code+" · "+center.name:"Center",balance:Number(data)};
   }));centers.push(...batch);
  }
  centers.sort((a,b)=>a.name.localeCompare(b.name));
  return{total:centers.reduce((sum,center)=>sum+center.balance,0),centers};
 }
 const [purchases,sales,inventory,cash,orders]=await Promise.all([
  scope.purchases?amounts("purchase_orders"):null,scope.sales?amounts("sales_orders"):null,
  scope.inventory?stock():null,scope.cash?centerCash():null,
  scope.purchases?client.from("purchase_orders").select("id",{count:"exact",head:true}).eq("organization_id",scope.organizationId).eq("status","confirmed"):null,
 ]);
 if(orders?.error)throw new Error("Purchase order count could not be loaded.");
 return{day,todayPurchases:purchases?.total??null,todayPurchaseCount:purchases?.count??null,
  todaySales:sales?.total??null,todaySaleCount:sales?.count??null,purchaseOrderCount:scope.purchases?orders?.count??0:null,
  stock:inventory?.totals??null,stockSacks:inventory?.sacks??null,highestStock:inventory?.highest??null,centerCash:cash};
}
