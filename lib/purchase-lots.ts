export type PurchaseLotSelection={mode:"auto"|"number"|"existing";number?:string;lot_id?:string};
// Match the existing database's per-line 2-decimal total.
export function purchaseRowsTotal(lines:readonly {quantity:number;actual_price:number}[]){return lines.reduce((sum,line)=>sum+Math.round(Math.round(line.quantity*1000)*Math.round(line.actual_price*100)/1000),0)/100;}
