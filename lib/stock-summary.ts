export type StockBalance={key:string;centerId:string;center:string;locationId:string;location:string;productId:string;productCode:string;product:string;category:string;quality:string;unit:string;qty:number;value:number};
export type ProductStock = {
 key:string;productId:string;productCode:string;product:string;category:string;unit:string;
 quantity:number;value:number;locations:number;balances:StockBalance[];
};
export function stockDirection(type:string):number {
 return ["purchase_in","transfer_in","adjustment_in"].includes(type)?1:-1;
}
export function groupProductStock(rows:readonly StockBalance[]):ProductStock[] {
 const products=new Map<string,ProductStock>();
 for(const row of rows){
  const key=row.productId+":"+row.unit;
  const item=products.get(key)??{key,productId:row.productId,productCode:row.productCode,product:row.product,category:row.category,unit:row.unit,quantity:0,value:0,locations:0,balances:[]};
  item.quantity+=row.qty;item.value+=row.value;item.balances.push(row);products.set(key,item);
 }
 return [...products.values()].map(item=>({...item,locations:new Set(item.balances.map(row=>row.centerId+":"+row.locationId)).size}))
  .sort((a,b)=>a.product.localeCompare(b.product)||a.unit.localeCompare(b.unit));
}
