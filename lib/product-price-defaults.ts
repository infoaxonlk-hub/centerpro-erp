export type LatestPurchasePrice={product_id:string;quality_id:string;price:number|string;confirmed_at:string;purchase_id:string;line_id:string};
export function purchasePriceDefault(qualityId:string,defaultPrice:number|string,latest:LatestPurchasePrice[]){
 return Number(latest.find(row=>row.quality_id===qualityId)?.price??defaultPrice);
}
export function salesPriceDefault(configured:number|string|null|undefined,remembered:number|string|undefined){
 return Number(configured??remembered??0);
}
