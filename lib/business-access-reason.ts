import {suspensionMessage,type BusinessAccess} from './business-modules';
// Diagnostics only: the database's operational flag remains the authority.
export function businessAccessMessage(business:BusinessAccess,now=new Date()){
 if(business.operational)return 'Your business account is active.';
 if(business.businessStatus!=='active')return suspensionMessage;
 const s=business.subscription;
 if(!s?.status)return 'No subscription is configured for this business.';
 if(!['active','trialing'].includes(s.status))return 'Business operations are blocked: subscription status is '+s.status+'.';
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Colombo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const part=(type:string)=>parts.find(p=>p.type===type)!.value;
 const today=part('year')+'-'+part('month')+'-'+part('day');
 if(s.starts_on>today)return 'Your subscription starts on '+s.starts_on+'. Business operations are not available yet.';
 if(s.expires_on&&s.expires_on<today)return 'Your subscription expired on '+s.expires_on+', although its saved status is '+s.status+'. Update its expiration date before operating.';
 if(s.status==='trialing'&&!s.trial_ends_on)return 'Your trial has no end date configured. Update the subscription before operating.';
 if(s.status==='trialing'&&s.trial_ends_on!<today)return 'Your trial ended on '+s.trial_ends_on+'. Renew or update the subscription before operating.';
 return 'The server has blocked business operations despite the displayed active subscription. Contact support with the Business ID below to check the access configuration.';
}
