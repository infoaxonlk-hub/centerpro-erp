/** Sri Lankan calendar dates compared against UTC timestamps. */
export function colomboDay(timestamp:string){
 return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Colombo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(timestamp));
}
export function dateRange(params:{from?:string;to?:string}){
 const valid=(value?:string)=>value&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))?value:"";
 const from=valid(params.from),to=valid(params.to);
 // Colombo is UTC+05:30 throughout the period supported by this ERP.
 return {from,to,start:from?`${from}T00:00:00+05:30`:null,end:to?new Date(Date.parse(`${to}T00:00:00+05:30`)+86400000).toISOString():null};
}
