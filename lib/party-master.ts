import type {LegalMaster} from './legal-masters';
export type PartyMaster=LegalMaster&{phone:string|null;address:string|null;is_active:boolean;center_id?:string;party_classification:'individual'|'company'|null;nic?:string|null;nic_or_registration?:string|null;bank_details?:string|null;notes?:string|null};
export type PartyOrder={id:string;partyId:string|null;number:string;date:string;center:string;total:number;due:number;status:string;href?:string|null};
export type PartyRow={id:string;name:string;phone:string|null;address:string|null;is_active?:boolean;center_id?:string};
export const emptyParty=():PartyMaster=>({id:'',legal_revision:0,name:'',phone:null,address:null,is_active:true,party_classification:null,nic:null,registered_name:null,trading_name:null,legal_email:null,business_registration_number:null,tin:null,payment_terms_days:null,payment_terms_note:null,addresses:[],vat_registrations:[],can_edit:true});
export function normalizeCustomerNic(value:string|null|undefined):string|null{return value?.trim().replace(/[vx]$/,suffix=>suffix.toUpperCase())||null;}
export function customerNicValid(value:string|null|undefined):boolean{const normalized=normalizeCustomerNic(value);return normalized===null||/^([0-9]{9}[VX]|[0-9]{12})$/.test(normalized);}
