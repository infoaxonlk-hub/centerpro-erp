export type PurchaseLotSelection={mode:"auto"|"number"|"existing";number?:string;lot_id?:string};
export function purchaseProductLotError(lines:readonly {product_id:string;quality_id:string;lot_selection?:PurchaseLotSelection}[]){
 const groups=new Map<string,string>();
 for(const line of lines){const choice=line.lot_selection;const mode=choice?.mode??"auto";const identity=mode==="auto"?"auto":mode==="number"?`number:${choice?.number?.trim().toUpperCase()??""}`:`existing:${choice?.lot_id??""}`;const key=JSON.stringify([line.quality_id,identity]);
  if(groups.has(line.product_id)&&groups.get(line.product_id)!==key)return "All weighings of a product must use one quality and one lot. Review this draft's lot choices.";
  groups.set(line.product_id,key);
 }return "";
}
// Match the existing database's per-line 2-decimal total.
export function purchaseRowsTotal(lines:readonly {quantity:number;actual_price:number}[]){return lines.reduce((sum,line)=>sum+Math.round(Math.round(line.quantity*1000)*Math.round(line.actual_price*100)/1000),0)/100;}
