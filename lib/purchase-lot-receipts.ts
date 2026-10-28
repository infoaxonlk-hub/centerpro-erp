import type {LotReceipt} from "@/components/purchase-lot-receipts";
export const lotReceiptColumns="id,received_quantity,unit_purchase_price,unit_of_measure,received_at,purchase_id,purchase_lots!inner(lot_number),products(name,code,unit_of_measure),product_qualities(name),purchase_orders!inner(po_number,status),centers(name,code),locations(name,code)";
type Relation<T>=T|T[]|null;
type RawReceipt={id:string;received_quantity:number|string;unit_purchase_price:number|string;unit_of_measure:string;received_at:string;purchase_id:string;purchase_lots:Relation<{lot_number:string}>;products:Relation<{name:string;code:string;unit_of_measure:string}>;product_qualities:Relation<{name:string}>;purchase_orders:Relation<{po_number:string;status:string}>;centers:Relation<{name:string;code:string}>;locations:Relation<{name:string;code:string}>};
const one=<T,>(value:Relation<T>)=>Array.isArray(value)?value[0]:value;
export function mapLotReceipt(row:RawReceipt):LotReceipt{
 const lot=one(row.purchase_lots),product=one(row.products),quality=one(row.product_qualities),purchase=one(row.purchase_orders),center=one(row.centers),location=one(row.locations);
 return{id:row.id,lotNumber:lot?.lot_number??"—",product:[product?.code,product?.name].filter(Boolean).join(" · "),quality:quality?.name??"Standard",purchaseId:row.purchase_id,purchaseNumber:purchase?.po_number??"—",purchaseStatus:purchase?.status??"",center:[center?.code,center?.name].filter(Boolean).join(" · "),location:[location?.code,location?.name].filter(Boolean).join(" · "),quantity:Number(row.received_quantity),unit:row.unit_of_measure,unitPrice:Number(row.unit_purchase_price),receivedAt:row.received_at};
}
