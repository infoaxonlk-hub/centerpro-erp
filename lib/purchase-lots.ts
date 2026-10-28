export type PurchaseLotSelection={mode:"auto"|"number"|"existing";number?:string;lot_id?:string};
// Match the existing database's per-line 2-decimal total, including split rows.
export function purchaseRowsTotal(lines:readonly {quantity:number;actual_price:number}[]){return lines.reduce((sum,line)=>sum+Math.round(Math.round(line.quantity*1000)*Math.round(line.actual_price*100)/1000),0)/100;}
export function splitPurchaseLotRow<T extends {quantity:number;sack_count:number;lot_selection?:PurchaseLotSelection}>(line:T,quantity:number,sacks:number,requireSacks:boolean){
 const original=Math.round(line.quantity*1000),part=Math.round(quantity*1000);
 if(!Number.isFinite(quantity)||Math.abs(quantity*1000-part)>0.000001||Math.abs(line.quantity*1000-original)>0.000001||!Number.isSafeInteger(original)||part<=0||part>=original)throw new Error("Split quantity must be positive, less than the row quantity, and use up to 3 decimals.");
 if(!Number.isInteger(sacks)||sacks<0||sacks>line.sack_count||(requireSacks&&(sacks===0||sacks===line.sack_count)))throw new Error("Divide the sack count between the rows; tracked rows need at least one sack each.");
 return{remaining:{...line,quantity:(original-part)/1000,sack_count:line.sack_count-sacks},split:{...line,quantity:part/1000,sack_count:sacks,lot_selection:{mode:"auto"} as PurchaseLotSelection}};
}
