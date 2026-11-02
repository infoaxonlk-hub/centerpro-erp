export type PartySearch=Record<string,string|string[]|undefined>;
export function partyRecordId(params:PartySearch):string|undefined{
 const value=params.id??params.partyId??params.customerId??params.supplierId;
 return typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)?value:undefined;
}
export function partyRedirect(target:string,params:PartySearch){const id=partyRecordId(params);return target+(id?`${target.includes('?')?'&':'?'}id=${encodeURIComponent(id)}`:'');}
