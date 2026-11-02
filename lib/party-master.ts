import type {LegalMaster} from './legal-masters';
export type PartyMaster=LegalMaster&{phone:string|null;address:string|null;is_active:boolean;center_id?:string;party_classification:'individual'|'company'|null;nic_or_registration?:string|null;bank_details?:string|null;notes?:string|null};
export type PartyOrder={id:string;partyId:string|null;number:string;date:string;center:string;total:number;due:number;status:string;href?:string|null};
export type PartyRow={id:string;name:string;phone:string|null;address:string|null;is_active?:boolean;center_id?:string};
export const emptyParty=():PartyMaster=>({id:'',legal_revision:0,name:'',phone:null,address:null,is_active:true,party_classification:null,registered_name:null,trading_name:null,legal_email:null,business_registration_number:null,tin:null,payment_terms_days:null,payment_terms_note:null,addresses:[],vat_registrations:[],can_edit:true});
