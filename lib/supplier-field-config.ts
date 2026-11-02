/** Built-in supplier storage keys cannot change; labels, requirement and visibility can. */
export const supplierBaseFields = [
  {key:"name",label:"Supplier Name",type:"text",required:true},
  {key:"nic_or_registration",label:"NIC / Registration",type:"text",required:false},
  {key:"phone",label:"Phone",type:"text",required:false},
  {key:"address",label:"Address",type:"text",required:false},
  {key:"bank_details",label:"Bank Details",type:"text",required:false},
  {key:"notes",label:"Notes",type:"text",required:false},
] as const;
export type SupplierBaseKey = typeof supplierBaseFields[number]["key"];
export type StandardSupplierOverride = {
  organization_id?:string;field_key:SupplierBaseKey;label:string;
  is_active:boolean;is_required:boolean;
};
export type EffectiveSupplierBaseField = {
  key:SupplierBaseKey;label:string;type:"text";required:boolean;active:boolean;
};
export function effectiveSupplierBaseFields(overrides:readonly StandardSupplierOverride[]):EffectiveSupplierBaseField[] {
  const byKey=new Map(overrides.map(o=>[o.field_key,o]));
  return supplierBaseFields.map(f=>{
    const override=byKey.get(f.key);
    if(f.key==="name") return {...f,required:true,active:true,label:override?.label||f.label};
    return {...f,required:override?.is_required??false,active:override?.is_active??true,label:override?.label||f.label};
  });
}
