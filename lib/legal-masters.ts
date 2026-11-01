export type LegalKind = "customer" | "supplier" | "business";
export type LegalAddress = {id?:string;kind:"billing"|"delivery"|"registered";is_default:boolean;line1:string;line2:string|null;city:string|null;district:string|null;province:string|null;postal_code:string|null;country_code:string};
export type VatRegistration = {id?:string;status:"registered"|"not_registered"|"unknown";registration_number:string|null;valid_from:string;valid_to:string|null};
export type LegalMaster = {id:string;legal_revision:number;name:string;registered_name:string|null;trading_name:string|null;legal_email:string|null;business_registration_number:string|null;tin:string|null;payment_terms_days:number|null;payment_terms_note:string|null;addresses:LegalAddress[];vat_registrations:VatRegistration[];can_edit:boolean};
export type LegalSnapshotV1 = {schema_version:1;source_kind:LegalKind;source_id:string;as_of:string;party:Omit<LegalMaster,"addresses"|"vat_registrations"|"can_edit">;addresses:Record<LegalAddress["kind"],LegalAddress|null>;vat:VatRegistration|{status:"unknown"}};
// The database builder is authoritative and permission checked. JSON round-trip
// returns an owned value, not a mutable reference to a master-cache object.
export async function buildLegalSnapshot(client:{rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{message:string}|null}>},kind:LegalKind,id:string,date:string):Promise<LegalSnapshotV1>{
 const {data,error}=await client.rpc("build_legal_snapshot",{p_kind:kind,p_id:id,p_date:date});
 if(error)throw new Error(error.message);
 const snapshot=data as LegalSnapshotV1;
 if(snapshot?.schema_version!==1)throw new Error("legal.invalid_snapshot");
 return JSON.parse(JSON.stringify(snapshot)) as LegalSnapshotV1;
}
