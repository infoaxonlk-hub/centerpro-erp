export type FarmAdjustment={kind:'charge'|'deduction';description:string;amount:string|number};
export type FarmSeason={id:string;name:string;is_active:boolean;is_default:boolean};
export type FarmService={id:string;code:string;name:string;unit_of_measure:'Acre'|'Hour';default_sales_price:number|string;is_active:boolean};
export function farmTotal(quantity:string|number,rate:string|number,adjustments:FarmAdjustment[]){
 const finite=(v:string|number,decimals:number)=>{const n=Number(v);if(String(v).trim()===''||!Number.isFinite(n)||n<0||n>=1e9||Math.abs(n*10**decimals-Math.round(n*10**decimals))>1e-5)throw new Error('Enter valid quantities (3 decimals) and amounts (2 decimals).');return n;};
 const q=finite(quantity,3),r=finite(rate,2);if(q<=0)throw new Error('Quantity must be positive.');
 const exactSubtotal=(BigInt(Math.round(q*1000))*BigInt(Math.round(r*100))+BigInt(500))/BigInt(1000);
 if(exactSubtotal>=BigInt('100000000000000'))throw new Error('Bill amount is too large.');
 const subtotal=Number(exactSubtotal),charges=adjustments.filter(x=>x.kind==='charge').reduce((sum,x)=>sum+Math.round(finite(x.amount,2)*100),0),deductions=adjustments.filter(x=>x.kind==='deduction').reduce((sum,x)=>sum+Math.round(finite(x.amount,2)*100),0);
 if(adjustments.some(x=>!['charge','deduction'].includes(x.kind)||!x.description.trim())||adjustments.length>20)throw new Error('Each adjustment needs a description (maximum 20).');
 if(subtotal<=0||subtotal+charges-deductions<=0)throw new Error('Subtotal and total must be positive.');
 return{subtotal:subtotal/100,charges:charges/100,deductions:deductions/100,total:(subtotal+charges-deductions)/100};
}
export const farmMoney=(n:number)=>new Intl.NumberFormat('en-LK',{style:'currency',currency:'LKR'}).format(n);
export const farmStorageKey=(organization:string,user:string)=>`centerpro:farm:${organization}:${user}`;
export function farmNetworkFailure(error:unknown){
 const value=error as {code?:string;message?:string};
 if(value?.code&&['P0001','42501','22023','23505','23514','PGRST301','PGRST302'].includes(value.code))return false;
 return /failed to fetch|network|timeout|load failed|gateway|502|503|504/i.test(value?.message??'');
}
